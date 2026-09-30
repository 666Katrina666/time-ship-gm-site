import { useEffect, useState } from "./vendor/htm-preact.js";

// The canon built by tools/site_build.py. It changes only when the server
// restarts, so it is fetched once per page load and shared by every page.

let loading = null;

function index(data) {
  const byId = new Map(data.docs.map((d) => [d.id, d]));
  const byFile = new Map(data.docs.map((d) => [d.file, d]));
  // "doc/key" of a boundary section -> what the canon leaves open there;
  // boundarySource is the section of P1 that lists them.
  const boundaries = new Map(data.boundaries.items.map((b) => [`${b.doc}/${b.key}`, b.what]));
  const { doc, key } = data.boundaries;
  return { ...data, byId, byFile, boundaries, boundaryList: data.boundaries.items, boundarySource: { doc, key } };
}

export function loadCanon() {
  loading ??= fetch("data/canon.json")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("канона нет: сборка не удалась, причина — в отчёте сборщика"))))
    .then(index);
  return loading;
}

// { canon, error }: canon is null until loaded.
export function useCanon() {
  const [state, setState] = useState({ canon: null, error: null });
  useEffect(() => {
    loadCanon().then((canon) => setState({ canon, error: null }), (e) => setState({ canon: null, error: e.message }));
  }, []);
  return state;
}

// Site address of a canon section: "#/canon/read/<doc>/<key>"; a search
// query adds "?q=<query>", and the reader marks it in the section.
export function sectionHref(docId, key, query) {
  const q = query ? `?q=${encodeURIComponent(query)}` : "";
  return `#/canon/read/${docId}${key ? `/${encodeURIComponent(key)}` : ""}${q}`;
}

// Address of the search results: "#/canon/search/<query>".
export function searchHref(query) {
  return `#/canon/search${query ? `/${encodeURIComponent(query)}` : ""}`;
}

// Lenient like Python's unquote: a stray "%" stays as it is.
export function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// "<doc>/<key>?q=<query>" after "#/canon/read/" -> { docId, key, query }.
// The key is encoded, so a "?" in it never splits the address.
export function parseSectionPath(path) {
  const [where, q = ""] = path.split("?q=");
  const query = decode(q);
  const cut = where.indexOf("/");
  return cut < 0
    ? { docId: where, key: "", query }
    : { docId: where.slice(0, cut), key: decode(where.slice(cut + 1)), query };
}

// Link resolver for renderMarkdown in a canon file: a canon link
// "file.md#anchor" becomes a site address, as site_build.py resolves it.
export function canonLinks(canon, doc) {
  return (href) => {
    if (/^[a-z]+:\/\//.test(href)) return { href, kind: "web" };
    if (!/[./#]/.test(href)) return null; // notation sample such as "[Mirror Image](…)"
    if (href.startsWith("site/")) return { href: href.slice("site/".length), kind: "site" }; // a site file, e.g. a picture
    const cut = href.indexOf("#");
    const file = decode(cut < 0 ? href : href.slice(0, cut));
    const target = file ? canon.byFile.get(file) : doc;
    if (!target) return { kind: "outside", title: `${file} — файл вне сайта` };
    return { href: sectionHref(target.id, cut < 0 ? "" : decode(href.slice(cut + 1))), kind: "site" };
  };
}
