#!/usr/bin/env node
import path from "node:path";
import { DEFAULTS } from "./config.js";
import { runBaseline, runCheck, ROOT, DATA } from "./engine.js";

function parseArgs(argv) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--max") opts.maxPages = parseInt(argv[++i], 10);
    else if (a === "--breakpoints") opts.breakpoints = argv[++i].split(",");
    else if (a === "--threshold") opts.pixelThreshold = parseFloat(argv[++i]);
    else if (a === "--alert") opts.changeRatioAlert = parseFloat(argv[++i]);
    else positional.push(a);
  }
  return { opts, positional };
}

const log = (m) => console.log(m);

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { opts, positional } = parseArgs(rest);
  const url = positional[0];

  if (!cmd || !["baseline", "check"].includes(cmd) || !url) {
    console.log(`webreview — motor de visual regression

Uso:
  webreview baseline <url> [opciones]   Rastrea y guarda el estado de referencia
  webreview check <url> [opciones]      Recaptura y compara contra el baseline

Opciones:
  --max <n>            Máximo de páginas (def. ${DEFAULTS.maxPages})
  --breakpoints <a,b>  desktop,tablet,mobile (def. ${DEFAULTS.breakpoints.join(",")})
  --threshold <0-1>    Sensibilidad por píxel (def. ${DEFAULTS.pixelThreshold})
  --alert <0-1>        Ratio de cambio para alertar (def. ${DEFAULTS.changeRatioAlert})
`);
    process.exit(url ? 0 : 1);
  }

  if (cmd === "baseline") {
    console.log(`\n📸 Baseline de ${url}`);
    const r = await runBaseline(url, opts, { onLog: log });
    console.log(`\n✅ Baseline (${r.pages} páginas) en ${path.join("data", r.baselineDir)}`);
  } else {
    console.log(`\n🔍 Check de ${url}`);
    const r = await runCheck(url, opts, { onLog: log });
    const { compared, alerts, missing, newPages, removedPages } = r.summary;
    console.log("\n──────── RESULTADO ────────");
    console.log(`  Capturas comparadas: ${compared}`);
    console.log(`  ⚠️  Con cambios significativos: ${alerts}`);
    if (missing) console.log(`  Sin par (missing): ${missing}`);
    if (newPages.length) console.log(`  Páginas nuevas: ${newPages.length}`);
    if (removedPages.length) console.log(`  Páginas eliminadas: ${removedPages.length}`);
    for (const p of r.report.pages) {
      for (const [bp, s] of Object.entries(p.shots)) {
        if (s.status === "changed") {
          console.log(`  ⚠️  ${p.slug} [${bp}] → ${s.changeRatio}% cambiado${s.dimsChanged ? " (dimensiones distintas)" : ""}`);
        }
      }
    }
    console.log(`\n📄 Informe: ${path.join("data", r.runDir, "report.json")}`);
  }
}

main().catch((err) => {
  console.error("✗ Error:", err.message);
  process.exit(1);
});
