import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runBaseline, runCheck, runDiscover, DATA } from "./engine.js";

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.WEBREVIEW_TOKEN || ""; // si vacío, sin auth (solo dev)

// Cola de jobs en memoria (para el prototipo). En producción → Redis/BullMQ.
const jobs = new Map();
const MAX_CONCURRENT = parseInt(process.env.WEBREVIEW_CONCURRENCY || "1", 10);
let running = 0;
const pending = [];

function enqueue(job) {
  jobs.set(job.id, job);
  pending.push(job);
  drain();
}

async function drain() {
  if (running >= MAX_CONCURRENT || pending.length === 0) return;
  const job = pending.shift();
  running++;
  job.status = "running";
  job.startedAt = new Date().toISOString();
  const onLog = (m) => { job.logs.push(m); if (job.logs.length > 200) job.logs.shift(); };
  try {
    const fn = job.type === "baseline" ? runBaseline
      : job.type === "discover" ? runDiscover
      : runCheck;
    job.result = await fn(job.url, job.options, { onLog });
    job.status = "done";
  } catch (err) {
    job.status = "error";
    job.error = err.message;
  } finally {
    job.finishedAt = new Date().toISOString();
    running--;
    drain();
  }
}

// ---- helpers HTTP ----
const MIME = { ".png": "image/png", ".json": "application/json", ".jpg": "image/jpeg" };

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
  });
}

function authOk(req) {
  if (!TOKEN) return true;
  const h = req.headers["authorization"] || "";
  return h === `Bearer ${TOKEN}`;
}

// Sirve archivos estáticos de DATA (capturas y diffs).
async function serveData(req, res, urlPath) {
  const rel = decodeURIComponent(urlPath.replace(/^\/data\//, ""));
  const file = path.join(DATA, rel);
  if (!file.startsWith(DATA)) return send(res, 403, { error: "forbidden" });
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    send(res, 404, { error: "not found" });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (req.method === "OPTIONS") return send(res, 204, {});
  if (p === "/health") return send(res, 200, { ok: true, jobs: jobs.size, running });
  if (p.startsWith("/data/")) return serveData(req, res, p);

  if (!authOk(req)) return send(res, 401, { error: "unauthorized" });

  // Lanzar un job: { type: "baseline"|"check", url, options }
  if (p === "/jobs" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.url || !["baseline", "check", "discover"].includes(body.type)) {
      return send(res, 400, { error: "type (baseline|check|discover) y url son obligatorios" });
    }
    const job = {
      id: randomUUID(), type: body.type, url: body.url,
      options: body.options || {}, status: "queued", logs: [],
      result: null, error: null, createdAt: new Date().toISOString(),
    };
    enqueue(job);
    return send(res, 202, { id: job.id, status: job.status });
  }

  // Consultar estado de un job.
  const m = p.match(/^\/jobs\/([\w-]+)$/);
  if (m && req.method === "GET") {
    const job = jobs.get(m[1]);
    if (!job) return send(res, 404, { error: "job no encontrado" });
    return send(res, 200, {
      id: job.id, type: job.type, url: job.url, status: job.status,
      logs: job.logs, result: job.result, error: job.error,
      createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt,
    });
  }

  send(res, 404, { error: "ruta no encontrada" });
});

// Asegura que existe el directorio de datos.
fs.mkdirSync(DATA, { recursive: true });
server.listen(PORT, () => {
  console.log(`WebReview engine API escuchando en :${PORT} (data: ${DATA}, auth: ${TOKEN ? "on" : "off"})`);
});
