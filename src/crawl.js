import { normalizeUrl } from "./util.js";

// Rastreo BFS del mismo origen a partir de una URL semilla.
// Devuelve una lista ordenada de URLs (incluida la semilla) hasta maxPages.
export async function crawl(context, startUrl, { maxPages, navTimeoutMs }) {
  const origin = new URL(startUrl).origin;
  const seed = normalizeUrl(startUrl);
  const seen = new Set([seed]);
  const queue = [seed];
  const result = [];

  const page = await context.newPage();

  while (queue.length && result.length < maxPages) {
    const url = queue.shift();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: navTimeoutMs });
    } catch (err) {
      console.warn(`  ! no se pudo abrir ${url}: ${err.message}`);
      continue;
    }
    result.push(url);

    const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.href));
    for (const href of hrefs) {
      const norm = normalizeUrl(href);
      if (!norm || seen.has(norm)) continue;
      // Mismo origen y sin recursos/archivos no navegables.
      if (!norm.startsWith(origin)) continue;
      if (/\.(pdf|zip|jpg|jpeg|png|gif|svg|webp|mp4|mp3|css|js|xml|json)(\?|$)/i.test(norm)) continue;
      seen.add(norm);
      if (result.length + queue.length < maxPages) queue.push(norm);
    }
  }

  await page.close();
  return result;
}
