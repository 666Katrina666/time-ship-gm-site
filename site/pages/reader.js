import { html, useEffect, useMemo, useState } from "../vendor/htm-preact.js";
import { canonLinks, parseSectionPath, sectionHref, useCanon } from "../canon.js";
import { renderInline, renderMarkdown } from "../markdown.js";
import { markTerms, parseQuery } from "../search.js";
import { markTermsHtml } from "../terms.js";
import { Lightbox } from "../pictures.js";
import { creatureHref } from "./creatures.js";
import { hazardHref } from "./hazards.js";
import { npcHref } from "./npcs.js";
import { itemHref } from "./items.js";

// Reader of the canon: one file at a time, whole, with its table of contents.
// Address "#/canon/read/<doc>/<section key>"; without a file it lists them.
// A search result adds "?q=<query>": the section shows the query marked.
// PF2 conditions and traits get a tooltip, except in the glossary: there
// they are defined. A picture of the canon opens over the whole window.

const TOC_DEPTH = 3;

function setTitle(title) {
  document.title = `${title} — Корабль Времени`;
}
const plain = (title) => title.replace(/[*`]/g, "");

function scrollToSection(key) {
  // The table of contents first: its scroll may move the window, the section
  // scroll then sets the final place.
  document.querySelector(".toc .active")?.scrollIntoView({ block: "nearest" });
  const section = key && document.getElementById(`s:${key}`);
  if (section) section.scrollIntoView();
  else scrollTo(0, 0);
}

function BoundaryMark({ canon, what }) {
  const { doc, key } = canon.boundarySource;
  return html`
    <a class="boundary" href=${sectionHref(doc, key)}
       title="Канон намеренно оставляет это открытым; без нового источника не достраивается">
      канон не задаёт: ${what}
    </a>
  `;
}

function Toc({ canon, doc, active }) {
  const docs = (kind) => canon.docs.filter((d) => d.kind === kind).map((d) => html`
    <option value=${d.id}>${d.short}</option>
  `);
  return html`
    <nav class="toc">
      <select value=${doc.id} onChange=${(e) => (location.hash = sectionHref(e.target.value))}>
        <optgroup label="Канон">${docs("canon")}</optgroup>
        <optgroup label="Справочные файлы">${docs("companion")}</optgroup>
      </select>
      <ol>
        ${doc.sections.filter((s) => s.level >= 2 && s.level <= TOC_DEPTH).map((s) => html`
          <li key=${s.key} class=${`l${s.level}${s.key === active ? " active" : ""}`}>
            <a href=${sectionHref(doc.id, s.key)}
               class=${canon.boundaries.has(`${doc.id}/${s.key}`) ? "open" : ""}>${plain(s.title)}</a>
          </li>
        `)}
      </ol>
    </nav>
  `;
}

// Marks the query in the target section and brings the first hit of its
// text into view if the section scroll left it below the window.
function markQuery(key, query) {
  const section = key && query && document.getElementById(`s:${key}`);
  if (!section) return undefined;
  const unmark = markTerms(section, parseQuery(query));
  const first = section.querySelector(".md mark.hit");
  if (first && first.getBoundingClientRect().bottom > innerHeight) first.scrollIntoView({ block: "center" });
  return unmark;
}

function Doc({ canon, doc, target, query }) {
  const sections = useMemo(() => {
    const link = canonLinks(canon, doc);
    const terms = doc.id === canon.terms?.doc ? (body) => body : (body) => markTermsHtml(body, canon);
    return doc.sections.map((s) => ({ ...s, heading: renderInline(s.title, link), body: terms(renderMarkdown(s.text, link)) }));
  }, [doc]);
  const byKey = useMemo(() => new Map(doc.sections.map((s) => [s.key, s])), [doc]);
  // A stat block, an NPC card or an item section links to its card on the site.
  const cards = useMemo(() => new Map([
    ...canon.creatures.filter((c) => c.doc === doc.id).map((c) => [c.key, creatureHref(c.id)]),
    ...canon.hazards.filter((h) => h.doc === doc.id).map((h) => [h.key, hazardHref(h.id)]),
    ...canon.npcs.filter((n) => n.doc === doc.id).map((n) => [n.key, npcHref(n.id)]),
    ...canon.items.filter((i) => i.doc === doc.id).map((i) => [i.key, itemHref(i.id)]),
  ]), [doc]);
  const missing = target && !byKey.has(target);
  const [figure, setFigure] = useState(null);

  // The table of contents shows only the upper levels: a deeper section
  // lights up its nearest shown ancestor.
  let active = byKey.get(target);
  while (active && active.level > TOC_DEPTH) active = byKey.get(active.parent);

  useEffect(() => { setTitle(doc.short); }, [doc]);
  useEffect(() => { scrollToSection(target); }, [doc, target]);
  useEffect(() => markQuery(target, query), [doc, target, query]);

  // A link to the section already in the address changes nothing in it, so
  // the page scrolls by itself.
  const onClick = (e) => {
    const img = e.target.closest(".md img.figure");
    if (img) {
      setFigure({ src: img.getAttribute("src"), alt: img.alt });
      return;
    }
    const a = e.target.closest("a[href^='#/canon/read/']");
    if (a && a.getAttribute("href") === location.hash) {
      e.preventDefault();
      scrollToSection(target);
    }
  };

  return html`
    <div class="reader" onClick=${onClick}>
      <${Toc} canon=${canon} doc=${doc} active=${active?.key} />
      <article class="doc">
        ${missing && html`<p class="bad">В файле нет раздела «${target}»: показано начало файла.</p>`}
        ${sections.map((s) => {
          const Heading = `h${Math.min(s.level, 6)}`;
          const what = canon.boundaries.get(`${doc.id}/${s.key}`);
          return html`
            <section key=${s.key} id=${`s:${s.key}`}>
              <${Heading}>
                <span dangerouslySetInnerHTML=${{ __html: s.heading }} />
                <a class="anchor" href=${sectionHref(doc.id, s.key)} title="Адрес раздела">#</a>
                ${cards.has(s.key) && html`<a class="card-link" href=${cards.get(s.key)}>карточка</a>`}
              <//>
              ${what && html`<${BoundaryMark} canon=${canon} what=${what} />`}
              <div class="md" dangerouslySetInnerHTML=${{ __html: s.body }} />
            </section>
          `;
        })}
      </article>
      ${figure && html`<${Lightbox} src=${figure.src} alt=${figure.alt} onClose=${() => setFigure(null)} />`}
    </div>
  `;
}

function DocList({ canon, unknown }) {
  useEffect(() => { setTitle("Пункты"); }, []);
  const docs = (kind) => html`
    <ul class="doclist">
      ${canon.docs.filter((d) => d.kind === kind).map((d) => html`
        <li key=${d.id}>
          <a href=${sectionHref(d.id)}>${d.short}</a>
          <span class="muted">разделов: ${d.sections.length}</span>
        </li>
      `)}
    </ul>
  `;
  const { doc, key } = canon.boundarySource;
  return html`
    <section class="page">
      <h1>Пункты</h1>
      ${unknown && html`<p class="bad">Файла «${unknown}» на сайте нет.</p>`}
      <h2>Канон</h2>
      ${docs("canon")}
      <h2>Справочные файлы</h2>
      <p class="muted">Файлы, на которые ссылается канон. Действует текст пунктов.</p>
      ${docs("companion")}
      <h2>Границы канона</h2>
      <p class="muted">
        Эти места канон намеренно не задаёт, и сайт их не достраивает
        (<a href=${sectionHref(doc, key)}>П1, «Границы канона»</a>).
      </p>
      <ul class="doclist">
        ${canon.boundaryList.map((b) => html`
          <li key=${`${b.doc}/${b.key}`}>
            <a href=${sectionHref(b.doc, b.key)}>${b.what}</a>
            <span class="muted">${canon.byId.get(b.doc).short}</span>
          </li>
        `)}
      </ul>
    </section>
  `;
}

export function ReaderPage({ rest }) {
  const { canon, error } = useCanon();
  if (error) {
    return html`
      <section class="page">
        <h1>Пункты</h1>
        <p class="bad">${error}</p>
        <p><a href="#/tools/build-report">Отчёт сборщика</a></p>
      </section>
    `;
  }
  if (!canon) return html`<section class="page"><p class="muted">Загрузка канона…</p></section>`;
  const { docId, key, query } = parseSectionPath(rest);
  const doc = canon.byId.get(docId);
  if (!doc) return html`<${DocList} canon=${canon} unknown=${docId} />`;
  return html`<${Doc} key=${doc.id} canon=${canon} doc=${doc} target=${key} query=${query} />`;
}
