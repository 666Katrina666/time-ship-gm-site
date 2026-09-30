// Markdown of the canon to HTML, in the Obsidian flavour the canon is written
// in: a single line break stays a break. Covers only what the canon uses:
// paragraphs, lists, tables, quotes, code blocks, rules; inline bold, italic,
// code, links, images and backslash escapes. No raw HTML or footnotes.
//
// Links and images go through link(href), which returns { href, kind, title }
// with kind "site", "web" or "outside", or null to leave the text as it is
// written. An image is <img class="figure">; one outside the site stays text.

const RE_FENCE = /^ {0,3}```/;
const RE_RULE = /^ {0,3}([-*_])( *\1){2,} *$/;
const RE_QUOTE = /^ {0,3}>/;
const RE_LIST = /^( *)([-*+]|(\d+)[.)])\s+(.*)$/;
const RE_TABLE_ALIGN = /^ *\|?( *:?-+:? *\|)+( *:?-+:? *)?$/;

export function renderMarkdown(text, link) {
  return blocks(text.split("\n"), link);
}

// One line such as a heading: inline markup only.
export function renderInline(text, link) {
  return inline(text, link);
}

export function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const indentOf = (line) => line.length - line.trimStart().length;

function isTable(lines, i) {
  return lines[i].trimStart().startsWith("|") && i + 1 < lines.length && RE_TABLE_ALIGN.test(lines[i + 1]);
}

function startsBlock(lines, i) {
  const line = lines[i];
  return RE_FENCE.test(line) || RE_RULE.test(line) || RE_QUOTE.test(line) || RE_LIST.test(line) || isTable(lines, i);
}

function blocks(lines, link) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
    } else if (RE_FENCE.test(line)) {
      let end = i + 1;
      while (end < lines.length && !RE_FENCE.test(lines[end])) end++;
      out.push(`<pre><code>${escapeHtml(lines.slice(i + 1, end).join("\n"))}</code></pre>`);
      i = end + 1;
    } else if (RE_RULE.test(line)) {
      out.push("<hr>");
      i++;
    } else if (RE_QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && RE_QUOTE.test(lines[i])) body.push(lines[i++].replace(/^ *> ?/, ""));
      out.push(`<blockquote>${blocks(body, link)}</blockquote>`);
    } else if (isTable(lines, i)) {
      i = table(lines, i, out, link);
    } else if (RE_LIST.test(line)) {
      i = list(lines, i, out, link);
    } else {
      const para = [];
      do para.push(lines[i++].trim());
      while (i < lines.length && lines[i].trim() && !startsBlock(lines, i));
      out.push(`<p>${inline(para.join("\n"), link).replace(/\n/g, "<br>")}</p>`);
    }
  }
  return out.join("\n");
}

// One list: items of the same indent and kind. An item owns the lines below
// it that are indented deeper, blank lines between them and lazy
// continuation lines of its paragraph.
function list(lines, i, out, link) {
  const first = RE_LIST.exec(lines[i]);
  const indent = first[1].length;
  const ordered = first[3] !== undefined;
  const items = [];
  while (i < lines.length) {
    const m = RE_LIST.exec(lines[i]);
    if (!m || m[1].length !== indent || (m[3] !== undefined) !== ordered) break;
    const body = [];
    for (i++; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) {
        let next = i;
        while (next < lines.length && !lines[next].trim()) next++;
        if (next < lines.length && indentOf(lines[next]) > indent) {
          body.push("");
          continue;
        }
        // A blank line between two items of this list does not end it.
        const sibling = next < lines.length && RE_LIST.exec(lines[next]);
        if (sibling && sibling[1].length === indent) i = next;
        break;
      }
      if (indentOf(line) <= indent && startsBlock(lines, i)) break;
      body.push(line);
    }
    const shift = Math.min(...body.filter((l) => l.trim()).map(indentOf));
    const own = [m[4], ...body.map((l) => l.slice(Math.min(shift, indentOf(l))))];
    // Tight list: the first paragraph of an item is not wrapped in <p>.
    items.push(`<li>${blocks(own, link).replace(/^<p>([\s\S]*?)<\/p>/, "$1")}</li>`);
  }
  const start = ordered && first[3] !== "1" ? ` start="${Number(first[3])}"` : "";
  out.push(ordered ? `<ol${start}>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
  return i;
}

// Table cells split on "|" outside code spans and escapes.
function cells(line) {
  const result = [];
  let cell = "", code = false;
  const s = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === "\\" && s[k + 1] === "|") { cell += "|"; k++; continue; }
    if (ch === "`") code = !code;
    if (ch === "|" && !code) { result.push(cell.trim()); cell = ""; continue; }
    cell += ch;
  }
  result.push(cell.trim());
  return result;
}

function table(lines, i, out, link) {
  const align = cells(lines[i + 1]).map((c) =>
    c.endsWith(":") ? (c.startsWith(":") ? "center" : "right") : c.startsWith(":") ? "left" : "");
  const row = (line, tag) => `<tr>${cells(line).map((c, k) =>
    `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ""}>${inline(c, link)}</${tag}>`).join("")}</tr>`;
  const head = row(lines[i], "th");
  const body = [];
  for (i += 2; i < lines.length && lines[i].trimStart().startsWith("|"); i++) body.push(row(lines[i], "td"));
  out.push(`<div class="scroll"><table><thead>${head}</thead><tbody>${body.join("")}</tbody></table></div>`);
  return i;
}

// Code spans, escapes and links are cut out first as placeholders, so that
// escaping and emphasis never touch their contents.
function inline(text, link) {
  const saved = [];
  const hold = (html) => `\u0000${saved.push(html) - 1}\u0000`;
  let s = text
    .replace(/`([^`]+)`/g, (_, code) => hold(`<code>${escapeHtml(code)}</code>`))
    .replace(/\\([\\`*_[\]()#|>+-])/g, (_, ch) => hold(escapeHtml(ch)))
    .replace(/!\[([^\]]*)\]\(([^)\s]*)\)/g, (all, alt, href) => {
      const target = link(href);
      if (!target || target.kind === "outside") return hold(escapeHtml(all));
      return hold(`<img class="figure" src="${escapeHtml(target.href)}" alt="${escapeHtml(alt)}" title="Открыть в полном размере">`);
    })
    .replace(/(?<!!)\[([^\]]*)\]\(([^)\s]*)\)/g, (all, label, href) => {
      const target = link(href);
      if (!target) return hold(escapeHtml(all));
      const inner = emphasis(escapeHtml(label));
      const title = target.title ? ` title="${escapeHtml(target.title)}"` : "";
      if (target.kind === "outside") return hold(`<span class="outside"${title}>${inner}</span>`);
      const blank = target.kind === "web" ? ` target="_blank" rel="noopener"` : "";
      return hold(`<a href="${escapeHtml(target.href)}"${title}${blank}>${inner}</a>`);
    });
  s = emphasis(escapeHtml(s));
  // Placeholders may nest (a code span inside a link label).
  while (s.includes("\u0000")) s = s.replace(/\u0000(\d+)\u0000/g, (_, n) => saved[n]);
  return s;
}

// Emphasis with "*" by delimiter runs, as in CommonMark: a closing run
// matches the nearest opener, two stars from each side make <strong>, one
// makes <em>. So "**a *b***" and "***a***" come out right. A run opens when
// it is left-flanking and closes when it is right-flanking: next to
// punctuation a run only counts on the side of a space or more punctuation,
// so the "*" in "**a (*b*)**" opens after "(" instead of closing the "**".
const RE_SPACE = /\s/u;
const RE_PUNCT = /[\p{P}\p{S}]/u;

function emphasis(s) {
  const parts = s.split(/(\*+)/);
  const stack = [];
  for (let k = 1; k < parts.length; k += 2) {
    const prev = parts[k - 1].slice(-1), next = parts[k + 1].charAt(0);
    const run = { left: parts[k].length, open: [], close: [] };
    const loose = (ch) => ch === "" || RE_SPACE.test(ch) || RE_PUNCT.test(ch);
    run.canOpen = next !== "" && !RE_SPACE.test(next) && (!RE_PUNCT.test(next) || loose(prev));
    run.canClose = prev !== "" && !RE_SPACE.test(prev) && (!RE_PUNCT.test(prev) || loose(next));
    parts[k] = run;
    while (run.canClose && run.left > 0 && stack.length) {
      const opener = stack[stack.length - 1];
      const use = opener.left >= 2 && run.left >= 2 ? 2 : 1;
      const tag = use === 2 ? "strong" : "em";
      opener.open.unshift(`<${tag}>`);
      run.close.push(`</${tag}>`);
      opener.left -= use;
      run.left -= use;
      if (opener.left === 0) stack.pop();
    }
    if (run.canOpen && run.left > 0) stack.push(run);
  }
  return parts.map((p) => (typeof p === "string" ? p : p.close.join("") + "*".repeat(p.left) + p.open.join(""))).join("");
}
