import { createHash } from "node:crypto";

// Slug legible y único-ish para un dominio, usado como carpeta.
export function domainSlug(urlStr) {
  const u = new URL(urlStr);
  return u.hostname.replace(/^www\./, "").replace(/[^a-z0-9.-]/gi, "_");
}

// Slug estable para una URL concreta (path + query), usado como nombre de PNG.
export function pageSlug(urlStr) {
  const u = new URL(urlStr);
  let p = u.pathname.replace(/\/$/, "");
  if (p === "") p = "/home";
  let slug = p.replace(/[^a-z0-9]/gi, "_").replace(/^_+|_+$/g, "");
  if (u.search) {
    const h = createHash("md5").update(u.search).digest("hex").slice(0, 6);
    slug += "__q" + h;
  }
  return slug || "home";
}

// Normaliza una URL para deduplicar (quita hash y barra final).
export function normalizeUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    u.hash = "";
    if (u.pathname !== "/" && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    return u.toString();
  } catch {
    return null;
  }
}

export function timestampId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
