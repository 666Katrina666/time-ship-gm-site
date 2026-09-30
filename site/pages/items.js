import { html, useEffect, useMemo, useState } from "../vendor/htm-preact.js";
import { canonLinks, decode, sectionHref, useCanon } from "../canon.js";
import { renderInline } from "../markdown.js";
import { markTermsHtml } from "../terms.js";
import { Picture, useImages } from "../pictures.js";
import { defineSlice, dispatch, getState, useStore } from "../store.js";
import { CanonState, Markdown, More, Subtree, WhereFound, fold, setTitle } from "../card.js";

// Items of P12 with knowledge layers (canon.items, parsed by
// tools/site_items.py). "#/canon/items" lists them in canon order with the
// section of P12 each belongs to, and "#/canon/items/<id>" shows one card: the layers table with the
// players' marks, then the item as the canon writes it, without the table,
// then its "Подробно" sections folded (the rules of its top section first).
//
// A mark says the players know a layer row; on a critical failure row it
// says they believe the false conclusion. It is party state: the event
// "item-layer" { item, name, row, known } sets or clears it, so undo and
// every window follow. A row is keyed by its label as written in the canon.
// The creature cards show the layers of body parts (creature.parts) with the
// same block, keyed by the creature's id.

defineSlice("itemLayers", () => ({}), {
  "item-layer": (marks, data) => {
    const rows = (marks[data.item] ||= {});
    if (data.known) rows[data.row] = true;
    else delete rows[data.row];
  },
});

export function itemHref(id) {
  return `#/canon/items${id ? `/${encodeURIComponent(id)}` : ""}`;
}

const FALSE = "Критический провал";
const marksOf = (id) => getState().itemLayers?.[id] ?? {};
// "Изучение устройства, Ремесло, КС 15." as plain text, without the remarks after it.
const shortCheck = (check) => check
  .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*«»]/g, "")
  .split(/(?<=КС \d+)[.:;]/)[0];

// item: { id, name, check, layers }; name is how the journal calls it.
export function Layers({ canon, doc, item, title = "Слои знаний" }) {
  const marks = useStore(() => marksOf(item.id));
  const [error, setError] = useState(null);
  const rows = useMemo(() => {
    const link = canonLinks(canon, doc);
    return item.layers.map((l) => ({ ...l, html: markTermsHtml(renderInline(l.text, link), canon) }));
  }, [item]);
  const toggle = (row, known) => {
    setError(null);
    dispatch("item-layer", { item: item.id, name: item.name, row, known }).catch((e) => setError(e.message));
  };
  return html`
    <section class="layers">
      <h2>${title}</h2>
      <${Markdown} canon=${canon} doc=${doc} text=${item.check} />
      <table class="grid layers-table">
        <thead><tr><th title="Игроки уже знают эту строку">Знают</th><th>Степень</th><th>Что узнаёт персонаж</th></tr></thead>
        <tbody>
          ${rows.map((l) => {
            const known = !!marks[l.label];
            const hint = l.degree === FALSE ? "игроки поверили ложному выводу" : "игроки уже знают это";
            return html`
              <tr key=${l.label} class=${known ? "known" : ""}>
                <td><input type="checkbox" checked=${known} title=${hint} aria-label=${hint}
                           onChange=${(e) => toggle(l.label, e.target.checked)} /></td>
                <td class=${l.degree === FALSE ? "false-layer" : ""}>${l.label}</td>
                <td dangerouslySetInnerHTML=${{ __html: l.html }} />
              </tr>
            `;
          })}
        </tbody>
      </table>
      ${error && html`<p class="bad">${error}</p>`}
    </section>
  `;
}

function Card({ canon, item }) {
  const doc = canon.byId.get(item.doc);
  const images = useImages();
  const image = images?.[item.id];
  useEffect(() => { setTitle(item.name); scrollTo(0, 0); }, [item]);
  const group = doc.sections.find((s) => s.key === item.group);
  // An item that is also a creature (the Jaw) shares its id with the block.
  const creature = canon.creatures.find((c) => c.id === item.id);
  return html`
    <article class=${`sheet${image ? " has-picture" : ""}`}>
      <p class="muted"><a href=${itemHref()}>Все предметы</a> · ${group?.title}</p>
      <header class="sheet-head"><h1>${item.name}</h1></header>
      ${image && html`<${Picture} src=${image} alt=${item.name} />`}
      <${Layers} canon=${canon} doc=${doc} item=${item} />
      <h2>Описание</h2>
      <${Subtree} canon=${canon} doc=${doc} keyOf=${item.key} level=${2}
                  replace=${{ key: item.block, text: item.rest }} />
      <${More} canon=${canon} parts=${item.more} />
      <${WhereFound} canon=${canon} kind="items" id=${item.id} />
      <p class="row sheet-links">
        ${creature && html`<a class="button" href=${`#/canon/creatures/${encodeURIComponent(creature.id)}`}>Существо: ${creature.name}</a>`}
        <a class="button" href=${sectionHref(item.doc, item.key)}>Открыть в ${doc.short.split(".")[0]}</a>
        ${images && !image && html`<span class="muted">Картинка: положите файл <code>site/img/${item.id}.png</code> (или .jpg, .webp)</span>`}
      </p>
    </article>
  `;
}

function List({ canon, unknown }) {
  const [filter, setFilter] = useState("");
  const marks = useStore(() => getState().itemLayers ?? {});
  useEffect(() => { setTitle("Предметы"); }, []);
  const doc = canon.byId.get("p12");
  const words = fold(filter).split(/\s+/).filter(Boolean);
  const groupOf = new Map(doc.sections.map((s) => [s.key, s.title]));
  const shown = canon.items.filter((i) => words.every((w) => fold(`${i.name} ${i.check} ${groupOf.get(i.group)}`).includes(w)));
  return html`
    <section class="page">
      <h1>Предметы</h1>
      <p class="muted">
        Предметы со слоями знаний. Отметка «знают» ставится в карточке на строку слоя и попадает в журнал.
        Остальные сокровища опознавать не нужно — они в <a href=${sectionHref("p12", doc.sections[0].key)}>П12</a>.
      </p>
      ${unknown && html`<p class="bad">Предмета «${unknown}» в каноне нет.</p>`}
      <div class="row">
        <input type="search" placeholder="Название, раздел или навык" value=${filter}
               onInput=${(e) => setFilter(e.target.value)} />
        <span class="muted">${shown.length} из ${canon.items.length}</span>
      </div>
      ${shown.length > 0 && html`
        <div class="scroll">
          <table class="grid items">
            <thead><tr><th>Предмет</th><th>Знают</th><th>Проверка</th><th>Раздел П12</th></tr></thead>
            <tbody>
              ${shown.map((i) => {
                const known = i.layers.filter((l) => marks[i.id]?.[l.label]).length;
                return html`
                  <tr key=${i.id}>
                    <td><a href=${itemHref(i.id)}>${i.name}</a></td>
                    <td class=${known ? "" : "muted"}>${known ? `${known} из ${i.layers.length}` : "—"}</td>
                    <td class="muted">${shortCheck(i.check)}</td>
                    <td class="muted">${groupOf.get(i.group)}</td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
      `}
      ${shown.length === 0 && html`<p class="muted">Ничего не найдено.</p>`}
    </section>
  `;
}

export function ItemsPage({ rest }) {
  const { canon, error } = useCanon();
  if (error || !canon) return html`<${CanonState} title="Предметы" error=${error} />`;
  const id = decode(rest);
  const item = id && canon.items.find((i) => i.id === id);
  if (!item) return html`<${List} canon=${canon} unknown=${id} />`;
  return html`<${Card} key=${item.id} canon=${canon} item=${item} />`;
}
