import { normalizeUrl } from "./util.js";

// Recursos no navegables que se ignoran durante el rastreo.
const IGNORE_EXT = /\.(pdf|zip|jpg|jpeg|png|gif|svg|webp|mp4|mp3|css|js|xml|json)(\?|$)/i;

// Clases de <body> específicas de una instancia concreta (no definen plantilla).
const INSTANCE_CLASS = /^(postid-|page-id-|parent-pageid-|page-child$|term-|category-\d)/;

// Clases de <body> presentes en todas partes (ruido que no distingue plantilla).
const NOISE_CLASS = new Set([
  "logged-in", "admin-bar", "no-customize-support", "customize-support",
  "wp-custom-logo", "wp-embed-responsive", "wp-singular", "hfeed",
]);

/**
 * Rastreo BFS del mismo origen SIN capturar: recolecta URLs y, por cada una,
 * la clase del <body> (útil para detectar la plantilla en sitios WordPress).
 * Devuelve las URLs agrupadas por plantilla/patrón.
 */
export async function discover(context, startUrl, { discoverMaxPages = 300, navTimeoutMs = 30000 } = {}) {
  const origin = new URL(startUrl).origin;
  const seed = normalizeUrl(startUrl);
  const seen = new Set([seed]);
  const queue = [seed];
  const pages = []; // { url, bodyClass }

  const page = await context.newPage();
  while (queue.length && pages.length < discoverMaxPages) {
    const url = queue.shift();
    let bodyClass = "";
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: navTimeoutMs });
      bodyClass = await page.evaluate(() => document.body?.className || "");
    } catch {
      continue; // páginas rotas se descartan
    }
    pages.push({ url, bodyClass });

    const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.href));
    for (const href of hrefs) {
      const norm = normalizeUrl(href);
      if (!norm || seen.has(norm)) continue;
      if (!norm.startsWith(origin)) continue;
      if (IGNORE_EXT.test(norm)) continue;
      seen.add(norm);
      queue.push(norm);
    }
  }
  await page.close();

  return { origin, total: pages.length, groups: groupPages(pages) };
}

// Firma de plantilla a partir de las clases del body (limpiando ruido/instancia).
function templateSignature(bodyClass) {
  return (bodyClass || "")
    .split(/\s+/)
    .filter(Boolean)
    .filter((c) => !INSTANCE_CLASS.test(c) && !NOISE_CLASS.has(c) && !c.startsWith("theme-"))
    .sort()
    .join(" ");
}

// Nº mínimo de valores hermanos distintos para considerar una posición "variable".
const VAR_THRESHOLD = 3;

const segsOf = (urlStr) => new URL(urlStr).pathname.split("/").filter(Boolean);

function isNumericToken(seg) {
  if (/^\d{4}$/.test(seg)) return ":year";
  if (/^\d+$/.test(seg)) return ":id";
  if (/^[0-9a-f]{8,}$/i.test(seg)) return ":id";
  return null;
}

// Calcula el patrón de cada URL de forma GLOBAL: construye un trie de segmentos
// concretos y colapsa a `:var` las posiciones (a partir de nivel 1) donde el
// mismo prefijo tiene muchos valores distintos. Devuelve Map<url, patrón>.
function computeUrlPatterns(urls) {
  const root = { children: new Map() };
  for (const u of urls) {
    let node = root;
    for (const seg of segsOf(u)) {
      if (!node.children.has(seg)) node.children.set(seg, { children: new Map() });
      node = node.children.get(seg);
    }
  }
  const patterns = new Map();
  for (const u of urls) {
    let node = root;
    const parts = [];
    segsOf(u).forEach((seg, depth) => {
      const parent = node;
      node = parent.children.get(seg);
      const num = isNumericToken(seg);
      if (num) parts.push(num);
      // Nivel 0 = secciones (se mantienen literales); niveles profundos con
      // muchos hermanos = valores → comodín.
      else if (depth > 0 && parent.children.size >= VAR_THRESHOLD) parts.push(":var");
      else parts.push(seg);
    });
    patterns.set(u, parts.length ? "/" + parts.join("/") : "/");
  }
  return patterns;
}

// Patrón simple de una URL suelta (para etiquetas de plantillas WP sin pista clara).
function simpleUrlPattern(urlStr) {
  const parts = segsOf(urlStr).map((seg) => isNumericToken(seg) || (seg.length > 12 || seg.includes("-") ? ":slug" : seg));
  return parts.length ? "/" + parts.join("/") : "/";
}

// Etiqueta humana para plantillas WordPress conocidas.
function labelFor(key, kind, sampleUrl) {
  if (kind === "url") return key === "/" ? "Portada" : key;
  const has = (c) => key.split(" ").includes(c);
  if (has("home") || has("front-page")) return "Portada";
  if (has("error404")) return "Error 404";
  if (has("search")) return "Búsqueda";
  if (key.match(/single-product|woocommerce-page/)) return "Producto (WooCommerce)";
  if (has("single-post") || has("single")) return "Entrada de blog";
  if (has("blog")) return "Blog";
  if (has("archive") || has("category") || has("tag") || has("date")) return "Archivo / Categoría";
  const tpl = key.split(" ").find((c) => c.startsWith("page-template-"));
  if (tpl) return "Página · " + tpl.replace("page-template-", "");
  if (has("page")) return "Página";
  // Sin pistas WP claras: usa el patrón de URL de la muestra.
  return simpleUrlPattern(sampleUrl);
}

// Agrupa por firma de plantilla (o patrón de URL estructural si no hay clases útiles).
function groupPages(pages) {
  const urlPat = computeUrlPatterns(pages.map((p) => p.url));
  const groups = new Map();
  for (const pg of pages) {
    const sig = templateSignature(pg.bodyClass);
    const kind = sig ? "template" : "url";
    const key = sig || urlPat.get(pg.url);
    if (!groups.has(key)) {
      groups.set(key, { key, kind, label: labelFor(key, kind, pg.url), urls: [] });
    }
    groups.get(key).urls.push(pg.url);
  }
  return [...groups.values()]
    .map((g) => ({ key: g.key, kind: g.kind, label: g.label, count: g.urls.length, urls: g.urls }))
    .sort((a, b) => b.count - a.count);
}
