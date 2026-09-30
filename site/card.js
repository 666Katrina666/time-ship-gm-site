import { html, useMemo } from "./vendor/htm-preact.js";
import { canonLinks, sectionHref } from "./canon.js";
import { renderInline, renderMarkdown } from "./markdown.js";
import { markTermsHtml, termIndex } from "./terms.js";

// Parts shared by the canon cards (creatures, hazards): the block stays the
// canon's markdown, and a card only arranges it. A part is one subsection of
// the block as the builder lists it: { key, title, actions }.

export function setTitle(title) {
  document.title = `${title} — Корабль Времени`;
}

export const fold = (s) => s.toLowerCase().replace(/ё/g, "е");
export const signed = (n) => (n === undefined ? "—" : n > 0 ? `+${n}` : String(n).replace("-", "−"));

export function Traits({ canon, traits }) {
  const ids = termIndex(canon).traitIds;
  return html`
    <div class="traits">
      ${traits.map((name) => {
        const i = ids.get(name.toLowerCase());
        return i === undefined
          ? html`<span class="trait">${name}</span>`
          : html`<span class="trait term" data-term=${`t:${i}`}>${name}</span>`;
      })}
    </div>
  `;
}

export function Markdown({ canon, doc, text }) {
  const body = useMemo(() => markTermsHtml(renderMarkdown(text, canonLinks(canon, doc)), canon), [text]);
  return html`<div class="md" dangerouslySetInnerHTML=${{ __html: body }} />`;
}

// A section with everything under it, headings one level below `level`.
// `replace` swaps the text of one section: { key, text }.
export function Subtree({ canon, doc, keyOf, level, replace }) {
  const sections = useMemo(() => {
    const start = doc.sections.findIndex((s) => s.key === keyOf);
    if (start < 0) return [];
    const top = doc.sections[start].level;
    let end = start + 1;
    while (end < doc.sections.length && doc.sections[end].level > top) end++;
    return doc.sections.slice(start, end);
  }, [doc, keyOf]);
  const link = canonLinks(canon, doc);
  return sections.map((s, n) => {
    const Heading = `h${Math.min(level + s.level - sections[0].level, 6)}`;
    return html`
      <div key=${s.key}>
        ${n > 0 && html`<${Heading} dangerouslySetInnerHTML=${{ __html: renderInline(s.title, link) }} />`}
        ${(s.key === replace?.key ? replace.text : s.text) && html`
          <${Markdown} canon=${canon} doc=${doc} text=${s.key === replace?.key ? replace.text : s.text} />`}
      </div>
    `;
  });
}

export function Ability({ canon, doc, part }) {
  const link = canonLinks(canon, doc);
  return html`
    <section class="ability">
      <h3>
        <span dangerouslySetInnerHTML=${{ __html: renderInline(part.title, link) }} />
        ${part.actions && html`<span class="actions">${part.actions}</span>`}
      </h3>
      <${Subtree} canon=${canon} doc=${doc} keyOf=${part.key} level=${3} />
    </section>
  `;
}

// `href`, if given, leads to the section in the reader from inside the fold.
export function Info({ canon, doc, part, href }) {
  const link = canonLinks(canon, doc);
  return html`
    <details class="info">
      <summary dangerouslySetInnerHTML=${{ __html: renderInline(part.title, link) }} />
      ${href && html`<p class="muted"><a href=${href}>Открыть в ${doc.short.split(".")[0]}</a></p>`}
      <${Subtree} canon=${canon} doc=${doc} keyOf=${part.key} level=${4} />
    </details>
  `;
}

// "П8 · 14.4. Событийные триггеры … · Сарежейн" for a section of "Подробно":
// an unnumbered heading gets the numbered section above it.
function sectionLabel(doc, key) {
  const byKey = new Map(doc.sections.map((x) => [x.key, x]));
  const path = [];
  for (let s = byKey.get(key); s; s = byKey.get(s.parent)) {
    path.unshift(s.title);
    if (s.number) break;
  }
  return [doc.short.split(".")[0], ...path].join(" · ");
}

// The sections of a card's "Подробно" line ([{ doc, key }]), each folded on
// the card with a link to the reader inside (NPC and hazard cards).
export function More({ canon, parts }) {
  if (!parts?.length) return null;
  return html`
    <h2>Подробно</h2>
    ${parts.map((m) => {
      const doc = canon.byId.get(m.doc);
      return html`<${Info} key=${`${m.doc}/${m.key}`} canon=${canon} doc=${doc}
                          part=${{ key: m.key, title: sectionLabel(doc, m.key) }} href=${sectionHref(m.doc, m.key)} />`;
    })}
  `;
}

// "Где встречается": the P13 rooms whose related line names the card
// (canon.rooms, tools/site_rooms.py) and the P10 encounter rows whose card
// names it (canon.encounters, tools/site_encounters.py). kind is the list of
// a room or a row: "creatures", "hazards", "items" or "npcs". The room
// address is written here rather than imported, as card.js imports no page;
// a row links to its card section, since the encounters page shows one row
// only when it comes up.
export function WhereFound({ canon, kind, id }) {
  const rooms = canon.rooms.filter((r) => r[kind].includes(id));
  const rows = canon.encounters?.rows.filter((r) => r[kind].includes(id)) ?? [];
  // A creature's part in the row: its usual composition, the scene variants it is in.
  const role = (r) => {
    if (kind !== "creatures") return "";
    const variants = r.variants.filter((v) => v.creatures.includes(id)).map((v) => `«${v.name}»`);
    const parts = [r.main.includes(id) && "состав",
      variants.length && `${variants.length > 1 ? "варианты" : "вариант"} ${variants.join(", ")}`];
    return parts.filter(Boolean).join(" и ");
  };
  return html`
    <h2>Где встречается</h2>
    ${rooms.length > 0 && html`
      <p class="where">
        ${rooms.map((r) => html`<a key=${r.number} href=${`#/game/rooms/${r.number}`}>${r.number}. ${r.title}</a>`)}
      </p>`}
    ${rows.length > 0 && html`
      <p class="where">
        <span class="muted">Случайные встречи П10:</span>
        ${rows.map((r) => html`
          <span key=${r.number}>
            <a href=${sectionHref(canon.encounters.doc, r.key)}>№ ${r.number}. ${r.name}</a>
            ${role(r) && html` <span class="muted">— ${role(r)}</span>`}
            <span class="muted" title="Строка доступна с этого уровня партии"> · с ${r.level}-го</span>
          </span>
        `)}
      </p>`}
    ${rooms.length === 0 && rows.length === 0 && html`
      <p class="muted">Ни одна комната П13 и ни одна строка случайных встреч П10 не называют эту карточку.</p>`}
  `;
}

// The page of a card kind while the canon is loading or failed to build.
export function CanonState({ title, error }) {
  if (error) {
    return html`
      <section class="page">
        <h1>${title}</h1>
        <p class="bad">${error}</p>
        <p><a href="#/tools/build-report">Отчёт сборщика</a></p>
      </section>
    `;
  }
  return html`<section class="page"><p class="muted">Загрузка канона…</p></section>`;
}
