import { escapeHtml } from "./markdown.js";

// Search over every section of the canon. The index is plain text built in
// the browser on the first search: the canon is about a million characters,
// and scanning it per keystroke takes a few milliseconds.
//
// A query is words and "quoted phrases"; a section matches when it holds all
// of them, in the title or the text. Case and ё/е do not matter. A word
// matches inside longer words, so "кристалл" finds "Кристалла" too.

const SNIPPET_BEFORE = 60;
const SNIPPET_AFTER = 160;

// Lower case and ё -> е, keeping the length, so offsets in the normalised
// text point at the same characters in the original.
export function normalize(s) {
  const lower = s.toLowerCase();
  const same = lower.length === s.length ? lower : Array.from(s, (ch) => {
    const l = ch.toLowerCase();
    return l.length === ch.length ? l : ch;
  }).join("");
  return same.replace(/ё/g, "е");
}

// Markdown to the text a reader sees: links keep their labels, markup and
// table rules go, table cells are separated by " · ".
function plainText(md) {
  return md
    .split("\n")
    .filter((line) => !/^ *\|?( *:?-+:? *\|)+( *:?-+:? *)?$/.test(line))
    .map((line) => line
      .replace(/^ *\|(.*?)\|? *$/, (_, row) => row.split(/(?<!\\)\|/).map((c) => c.trim()).join(" · "))
      .replace(/^ *(>+|[-*+]|\d+[.)]|```.*) */, ""))
    .join("\n")
    .replace(/!?\[([^\]]*)\]\([^)\s]*\)/g, "$1")
    .replace(/\\([\\`*_[\]()#|>+-])/g, "$1")
    .replace(/[*`]/g, "")
    .replace(/[ \t]*\n\s*/g, " ")
    .trim();
}

let index = null;

function buildIndex(canon) {
  const entries = [];
  for (const doc of canon.docs) {
    const byKey = new Map(doc.sections.map((s) => [s.key, s]));
    for (const s of doc.sections) {
      // Breadcrumb from the file title down: "Тактика" alone says nothing.
      const path = [];
      for (let p = byKey.get(s.parent); p && p.level > 1; p = byKey.get(p.parent)) path.unshift(plainText(p.title));
      const title = plainText(s.title);
      const text = plainText(s.text);
      entries.push({ doc, key: s.key, path, title, text, titleN: normalize(title), textN: normalize(text) });
    }
  }
  return entries;
}

// Query -> distinct normalised terms; one-letter words are dropped.
export function parseQuery(query) {
  const terms = [];
  for (const m of normalize(query).matchAll(/"([^"]+)"|(\S+)/g)) {
    const term = (m[1] ?? m[2]).trim().replace(/\s+/g, " ");
    if (term.length >= 2 && !terms.includes(term)) terms.push(term);
  }
  return terms;
}

function count(haystack, term, cap) {
  let n = 0;
  for (let at = haystack.indexOf(term); at >= 0 && n < cap; at = haystack.indexOf(term, at + term.length)) n++;
  return n;
}

// Sections holding every term, best first. The canon comes before the
// companion files, whose text does not rule; then a term in the title
// outweighs any number of hits in the text; ties keep the canon order.
export function search(canon, terms) {
  index ??= buildIndex(canon);
  if (!terms.length) return [];
  const hits = [];
  index.forEach((e, rank) => {
    let score = 0;
    for (const term of terms) {
      const inTitle = e.titleN.includes(term);
      const inText = count(e.textN, term, 5);
      if (!inTitle && !inText) return;
      score += (inTitle ? 10 : 0) + inText;
    }
    hits.push({ entry: e, score, rank });
  });
  const companion = (h) => (h.entry.doc.kind === "canon" ? 0 : 1);
  hits.sort((a, b) => companion(a) - companion(b) || b.score - a.score || a.rank - b.rank);
  return hits.map((h) => h.entry);
}

// Every [start, end) of the terms in a normalised string, merged.
function ranges(normalized, terms) {
  const found = [];
  for (const term of terms) {
    for (let at = normalized.indexOf(term); at >= 0; at = normalized.indexOf(term, at + term.length)) {
      found.push([at, at + term.length]);
    }
  }
  found.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of found) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

// Escaped HTML of text with the terms wrapped in <mark>.
export function highlight(text, terms, normalized = normalize(text)) {
  let out = "", from = 0;
  for (const [start, end] of ranges(normalized, terms)) {
    out += escapeHtml(text.slice(from, start)) + `<mark>${escapeHtml(text.slice(start, end))}</mark>`;
    from = end;
  }
  return out + escapeHtml(text.slice(from));
}

// A piece of the section text around the first hit, highlighted; the start
// of the text if only the title matched.
export function snippet(entry, terms) {
  const { text, textN } = entry;
  const first = Math.min(...terms.map((t) => textN.indexOf(t)).filter((at) => at >= 0));
  const at = Number.isFinite(first) ? first : 0;
  let start = Math.max(0, at - SNIPPET_BEFORE);
  let end = Math.min(text.length, at + SNIPPET_AFTER);
  if (start > 0) start = text.indexOf(" ", start) + 1 || start;
  if (end < text.length) end = text.lastIndexOf(" ", end) > at ? text.lastIndexOf(" ", end) : end;
  const body = highlight(text.slice(start, end), terms, textN.slice(start, end));
  return (start > 0 ? "… " : "") + body + (end < text.length ? " …" : "");
}

// Marks the terms inside an element of the reader; returns the undo. Text
// split by markup (half a word in bold) is not matched.
export function markTerms(root, terms) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const found = ranges(normalize(node.data), terms);
    if (!found.length) continue;
    const parts = document.createDocumentFragment();
    let from = 0;
    for (const [start, end] of found) {
      parts.append(node.data.slice(from, start));
      const mark = document.createElement("mark");
      mark.className = "hit";
      mark.textContent = node.data.slice(start, end);
      parts.append(mark);
      from = end;
    }
    parts.append(node.data.slice(from));
    node.replaceWith(parts);
  }
  return () => {
    for (const mark of root.querySelectorAll("mark.hit")) {
      const parent = mark.parentNode;
      mark.replaceWith(mark.textContent);
      parent.normalize();
    }
  };
}
