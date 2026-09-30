import { html, useEffect, useMemo, useState } from "../vendor/htm-preact.js";
import { decode, sectionHref, useCanon } from "../canon.js";
import { highlight, parseQuery, search, snippet } from "../search.js";

// Search results for the query typed in the top bar. Address
// "#/canon/search/<query>"; a result opens the section with the query marked.

const PAGE = 50;

function Hint() {
  return html`
    <div class="muted">
      <p>Строка поиска — в шапке, на любой странице; Ctrl+K ставит в неё курсор.</p>
      <ul>
        <li>Раздел находится, если в нём есть все слова запроса — в заголовке или в тексте.</li>
        <li>Регистр и ё/е не важны; слово находится и внутри длинных слов: «кристалл» найдёт «Кристалла».</li>
        <li>Фраза в кавычках ищется целиком: <code>"мерцающая стена"</code>.</li>
        <li>Сначала канон, потом справочные файлы; выше — разделы, где слово стоит в заголовке.</li>
      </ul>
    </div>
  `;
}

// "П9" for a canon point, the first word for the other files.
const chipLabel = (doc) => /^П\d+/.exec(doc.short)?.[0] ?? doc.short.split(" ")[0];

function Result({ entry, terms, query }) {
  const { doc, key, path, title, titleN } = entry;
  return html`
    <li>
      <a class="title" href=${sectionHref(doc.id, key, query)}
         dangerouslySetInnerHTML=${{ __html: highlight(title, terms, titleN) }} />
      <div class="path muted">${[doc.short, ...path].join(" › ")}</div>
      ${entry.text && html`<div class="snippet" dangerouslySetInnerHTML=${{ __html: snippet(entry, terms) }} />`}
    </li>
  `;
}

export function SearchPage({ rest }) {
  const { canon, error } = useCanon();
  const query = decode(rest);
  const terms = useMemo(() => parseQuery(query), [query]);
  const results = useMemo(() => (canon ? search(canon, terms) : []), [canon, terms]);
  const [docFilter, setDocFilter] = useState(null);
  const [shown, setShown] = useState(PAGE);
  useEffect(() => { setDocFilter(null); setShown(PAGE); }, [query]);
  useEffect(() => { document.title = `${query ? `«${query}»` : "Поиск"} — Корабль Времени`; }, [query]);

  const perDoc = useMemo(() => {
    const counts = new Map();
    for (const e of results) counts.set(e.doc, (counts.get(e.doc) || 0) + 1);
    return [...counts].sort((a, b) => canon.docs.indexOf(a[0]) - canon.docs.indexOf(b[0]));
  }, [results]);

  if (error) return html`<section class="page"><h1>Поиск</h1><p class="bad">${error}</p></section>`;
  if (!canon) return html`<section class="page"><p class="muted">Загрузка канона…</p></section>`;

  const list = docFilter ? results.filter((e) => e.doc === docFilter) : results;
  return html`
    <section class="page search">
      <h1>Поиск${query && html` <span class="muted">«${query}»</span>`}</h1>
      ${!terms.length && html`<${Hint} />`}
      ${terms.length > 0 && !results.length && html`<p>Ничего не нашлось.</p><${Hint} />`}
      ${results.length > 0 && html`
        <p class="muted">Разделов: ${results.length}, файлов: ${perDoc.length}.</p>
        ${perDoc.length > 1 && html`
          <div class="filters">
            <button class=${docFilter ? "small" : "small on"} onClick=${() => setDocFilter(null)}>все</button>
            ${perDoc.map(([doc, n]) => html`
              <button key=${doc.id} class=${`small${doc === docFilter ? " on" : ""}`} title=${doc.title}
                      onClick=${() => { setDocFilter(doc); setShown(PAGE); }}>
                ${chipLabel(doc)} <span class="muted">${n}</span>
              </button>
            `)}
          </div>
        `}
        <ol class="results">
          ${list.slice(0, shown).map((e) => html`<${Result} key=${`${e.doc.id}/${e.key}`} entry=${e} terms=${terms} query=${query} />`)}
        </ol>
        ${list.length > shown && html`
          <button onClick=${() => setShown(shown + PAGE)}>Показать ещё (осталось ${list.length - shown})</button>
        `}
      `}
    </section>
  `;
}
