import fs from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

async function readPng(file) {
  const buf = await fs.readFile(file);
  return PNG.sync.read(buf);
}

// Rellena una imagen con blanco hasta el ancho/alto objetivo (top-left).
function padTo(png, width, height) {
  if (png.width === width && png.height === height) return png;
  const out = new PNG({ width, height });
  out.data.fill(0xff); // fondo blanco opaco
  PNG.bitblt(png, out, 0, 0, png.width, png.height, 0, 0);
  return out;
}

// Compara dos PNG y escribe la imagen de diff. Devuelve métricas.
async function diffPair(baseFile, newFile, diffFile, pixelThreshold) {
  const [a, b] = await Promise.all([readPng(baseFile), readPng(newFile)]);
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const pa = padTo(a, width, height);
  const pb = padTo(b, width, height);
  const diff = new PNG({ width, height });

  const changed = pixelmatch(pa.data, pb.data, diff.data, width, height, {
    threshold: pixelThreshold,
    includeAA: false,
    alpha: 0.4,
  });

  await fs.mkdir(path.dirname(diffFile), { recursive: true });
  await fs.writeFile(diffFile, PNG.sync.write(diff));

  const totalPx = width * height;
  return {
    changedPixels: changed,
    totalPixels: totalPx,
    changeRatio: changed / totalPx,
    dimsChanged: a.width !== b.width || a.height !== b.height,
    baseDims: { w: a.width, h: a.height },
    newDims: { w: b.width, h: b.height },
  };
}

// Compara un run completo contra el baseline. Empareja por slug+breakpoint.
export async function compareRun(baselineDir, runDir, opts) {
  const { pixelThreshold, changeRatioAlert } = opts;
  const baseManifest = JSON.parse(await fs.readFile(path.join(baselineDir, "manifest.json"), "utf8"));
  const runManifest = JSON.parse(await fs.readFile(path.join(runDir, "manifest.json"), "utf8"));

  const baseBySlug = new Map(baseManifest.pages.map((p) => [p.slug, p]));
  const diffRoot = path.join(runDir, "diff");
  const report = { comparedAt: new Date().toISOString(), pages: [], summary: {} };

  let alerts = 0, compared = 0, missing = 0;

  for (const rp of runManifest.pages) {
    const bp = baseBySlug.get(rp.slug);
    const pageReport = { url: rp.url, slug: rp.slug, shots: {} };

    for (const breakpoint of Object.keys(rp.shots)) {
      const newShot = rp.shots[breakpoint];
      const baseShot = bp?.shots?.[breakpoint];
      if (!newShot || !baseShot) {
        pageReport.shots[breakpoint] = { status: "missing" };
        missing++;
        continue;
      }
      const diffFile = path.join(diffRoot, breakpoint, `${rp.slug}.png`);
      const m = await diffPair(
        path.join(baselineDir, baseShot),
        path.join(runDir, newShot),
        diffFile,
        pixelThreshold
      );
      const status = m.changeRatio >= changeRatioAlert ? "changed" : "ok";
      if (status === "changed") alerts++;
      compared++;
      pageReport.shots[breakpoint] = {
        status,
        changeRatio: Number((m.changeRatio * 100).toFixed(3)),
        changedPixels: m.changedPixels,
        dimsChanged: m.dimsChanged,
        diff: path.relative(runDir, diffFile),   // relativa al runDir
        newImg: newShot,                          // relativa al runDir
        baseImg: baseShot,                        // relativa al baselineDir
      };
    }
    report.pages.push(pageReport);
  }

  // Páginas nuevas o eliminadas respecto al baseline.
  const runSlugs = new Set(runManifest.pages.map((p) => p.slug));
  report.summary = {
    compared,
    alerts,
    missing,
    newPages: runManifest.pages.filter((p) => !baseBySlug.has(p.slug)).map((p) => p.url),
    removedPages: baseManifest.pages.filter((p) => !runSlugs.has(p.slug)).map((p) => p.url),
  };

  await fs.writeFile(path.join(runDir, "report.json"), JSON.stringify(report, null, 2));
  return report;
}
