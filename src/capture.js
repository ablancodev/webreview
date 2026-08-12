import fs from "node:fs/promises";
import path from "node:path";
import { BREAKPOINTS, FREEZE_CSS } from "./config.js";
import { pageSlug } from "./util.js";

// Desplaza la página hasta el fondo para disparar lazy-load y vuelve arriba.
async function triggerLazyLoad(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const step = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        total += step;
        if (total >= document.body.scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 50);
    });
  });
}

// Captura todas las URLs en todos los breakpoints indicados.
// Devuelve un manifest con las capturas realizadas.
export async function capture(context, urls, outDir, opts, onLog = () => {}) {
  const { breakpoints, navTimeoutMs, stabilizeMs } = opts;
  const manifest = { createdAt: new Date().toISOString(), pages: [] };

  for (const bp of breakpoints) {
    const size = BREAKPOINTS[bp];
    if (!size) throw new Error(`Breakpoint desconocido: ${bp}`);
    await fs.mkdir(path.join(outDir, bp), { recursive: true });
  }

  for (const url of urls) {
    const slug = pageSlug(url);
    const entry = { url, slug, shots: {} };

    for (const bp of breakpoints) {
      const size = BREAKPOINTS[bp];
      const page = await context.newPage();
      await page.setViewportSize(size);
      try {
        await page.goto(url, { waitUntil: "load", timeout: navTimeoutMs });
        await page.addStyleTag({ content: FREEZE_CSS });
        await triggerLazyLoad(page);
        try {
          await page.waitForLoadState("networkidle", { timeout: 5000 });
        } catch { /* seguimos aunque no llegue a idle */ }
        await page.waitForTimeout(stabilizeMs);

        const file = path.join(outDir, bp, `${slug}.png`);
        await page.screenshot({ path: file, fullPage: true });
        entry.shots[bp] = path.relative(outDir, file);
      } catch (err) {
        console.warn(`  ! captura fallida ${bp} ${url}: ${err.message}`);
        entry.shots[bp] = null;
      } finally {
        await page.close();
      }
    }
    manifest.pages.push(entry);
    onLog(`  ✓ ${slug} (${breakpoints.join(", ")})`);
  }

  await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}
