import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { DEFAULTS } from "./config.js";
import { crawl } from "./crawl.js";
import { discover } from "./discover.js";
import { capture } from "./capture.js";
import { compareRun } from "./compare.js";
import { domainSlug, timestampId } from "./util.js";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// Directorio de datos (capturas) — sobreescribible por env para el volumen Docker.
export const DATA = process.env.WEBREVIEW_DATA || path.join(ROOT, "data");

async function withBrowser(fn) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: "WebReviewBot/0.1 (+visual-regression)",
  });
  try {
    return await fn(context);
  } finally {
    await browser.close();
  }
}

const noop = () => {};

// Rastrea y guarda el estado de referencia. Devuelve resumen estructurado.
export async function runBaseline(url, options = {}, { onLog = noop } = {}) {
  const opts = { ...DEFAULTS, ...options };
  const site = domainSlug(url);
  const baselineDir = path.join(DATA, site, "baseline");
  await fs.rm(baselineDir, { recursive: true, force: true });
  await fs.mkdir(baselineDir, { recursive: true });

  // Si se pasa una lista curada de URLs, se captura tal cual (sin rastrear).
  const curated = Array.isArray(opts.urls) && opts.urls.length ? opts.urls : null;
  const result = await withBrowser(async (context) => {
    let urls;
    if (curated) {
      urls = curated;
      onLog(`${urls.length} páginas seleccionadas. Capturando...`);
    } else {
      onLog(`Rastreando ${url}...`);
      urls = await crawl(context, url, opts);
      onLog(`${urls.length} páginas encontradas. Capturando...`);
    }
    const manifest = await capture(context, urls, baselineDir, opts, onLog);
    await fs.writeFile(
      path.join(baselineDir, "crawl.json"),
      JSON.stringify({ startUrl: url, urls, opts }, null, 2)
    );
    return { urls, manifest };
  });

  onLog("Baseline guardado.");
  return {
    site,
    startUrl: url,
    pages: result.urls.length,
    breakpoints: opts.breakpoints,
    baselineDir: path.relative(DATA, baselineDir),
  };
}

// Recaptura las mismas páginas del baseline y compara. Devuelve el report.
export async function runCheck(url, options = {}, { onLog = noop } = {}) {
  const opts = { ...DEFAULTS, ...options };
  const site = domainSlug(url);
  const baselineDir = path.join(DATA, site, "baseline");

  try {
    await fs.access(path.join(baselineDir, "manifest.json"));
  } catch {
    throw new Error(`No hay baseline para ${site}. Crea primero un baseline.`);
  }

  const crawlInfo = JSON.parse(await fs.readFile(path.join(baselineDir, "crawl.json"), "utf8"));
  const runId = timestampId();
  const runDir = path.join(DATA, site, "runs", runId);
  await fs.mkdir(runDir, { recursive: true });

  onLog(`Capturando ${crawlInfo.urls.length} páginas del baseline...`);
  await withBrowser(async (context) => {
    await capture(context, crawlInfo.urls, runDir, opts, onLog);
  });

  onLog("Comparando contra baseline...");
  const report = await compareRun(baselineDir, runDir, opts);

  return {
    site,
    runId,
    runDir: path.relative(DATA, runDir),
    summary: report.summary,
    report,
  };
}

// Rastrea el árbol del sitio SIN capturar y devuelve las URLs agrupadas
// por plantilla, para que el usuario elija cuáles monitorizar.
export async function runDiscover(url, options = {}, { onLog = noop } = {}) {
  const opts = { ...DEFAULTS, ...options };
  onLog(`Descubriendo el árbol de ${url}...`);
  const result = await withBrowser((context) => discover(context, url, opts));
  onLog(`${result.total} URLs encontradas en ${result.groups.length} plantillas.`);
  return { site: domainSlug(url), startUrl: url, ...result };
}
