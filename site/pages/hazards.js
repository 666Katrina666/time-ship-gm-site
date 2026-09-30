import { html, useEffect, useState } from "../vendor/htm-preact.js";
import { canonLinks, decode, sectionHref, useCanon } from "../canon.js";
import { renderInline } from "../markdown.js";
import { Picture, useImages } from "../pictures.js";
import { ToScene } from "./scene.js";
import { Ability, CanonState, Info, Markdown, More, Traits, WhereFound, fold, setTitle } from "../card.js";

// Hazards of the P7 stat blocks (canon.hazards, parsed by
// tools/site_hazards.py). "#/canon/hazards" lists them, with the laws of the
// world that have no block (P7, section 11) as links to the reader, and
// "#/canon/hazards/<id>" shows one card: the block as the canon writes it,
// its reactions and routines, "Обоснование" folded, the sections of its
// "**Подробно**" line folded after it, and the GM's picture site/img/<id>.*
// if there is one.

const LAWS = "11"; // P7 section of the laws of the world without a stat block

export function hazardHref(id) {
  return `#/canon/hazards${id ? `/${encodeURIComponent(id)}` : ""}`;
}

const kindOf = (h) => (h.complex ? "Комплексная опасность" : "Опасность");

// "Рефлекс КС 20", "атака +20" or "—".
function checks(h) {
  const list = h.saves.map((s) => `${s.save} КС ${s.dc}`);
  if (h.numbers.attack !== undefined) list.push(`атака +${h.numbers.attack}`);
  return list.join(", ") || "—";
}

function Card({ canon, hazard: h }) {
  const doc = canon.byId.get(h.doc);
  const images = useImages();
  const image = images?.[h.id];
  useEffect(() => { setTitle(h.name); scrollTo(0, 0); }, [h]);
  return html`
    <article class=${`sheet${image ? " has-picture" : ""}`}>
      <p class="muted"><a href=${hazardHref()}>Все опасности</a></p>
      <header class="sheet-head">
        <h1>${h.name}</h1>
        <span class="level">${kindOf(h)} ${h.level}</span>
      </header>
      ${h.traits.length > 0 && html`<${Traits} canon=${canon} traits=${h.traits} />`}
      ${image && html`<${Picture} src=${image} alt=${h.name} />`}
      <div class="statblock"><${Markdown} canon=${canon} doc=${doc} text=${h.body} /></div>
      ${h.abilities.map((part) => html`<${Ability} key=${part.key} canon=${canon} doc=${doc} part=${part} />`)}
      ${h.info.length > 0 && html`
        <h2>Сведения</h2>
        ${h.info.map((part) => html`<${Info} key=${part.key} canon=${canon} doc=${doc} part=${part} />`)}
      `}
      <${More} canon=${canon} parts=${h.more} />
      <${WhereFound} canon=${canon} kind="hazards" id=${h.id} />
      <p class="row sheet-links">
        <${ToScene} kind="hazard" card=${h} />
        <a class="button" href=${sectionHref(h.doc, h.key)}>Открыть в ${doc.short.split(".")[0]}</a>
        ${images && !image && html`<span class="muted">Картинка: положите файл <code>site/img/${h.id}.png</code> (или .jpg, .webp)</span>`}
      </p>
    </article>
  `;
}

// Section 11 of P7: rules that act as laws of the world, without a block.
function Laws({ canon }) {
  const doc = canon.byId.get("p7");
  const top = doc?.sections.find((s) => s.number === LAWS);
  if (!top) return null;
  const link = canonLinks(canon, doc);
  const laws = doc.sections.filter((s) => s.parent === top.key);
  return html`
    <h2>Законы мира без блока</h2>
    <p class="muted">
      Эти опасности не бросают кубиков: они срабатывают как закон мира
      (<a href=${sectionHref(doc.id, top.key)}>${doc.short.split(".")[0]}, раздел ${LAWS}</a>).
    </p>
    <ul>
      ${laws.map((s) => html`
        <li key=${s.key}>
          <a href=${sectionHref(doc.id, s.key)} dangerouslySetInnerHTML=${{ __html: renderInline(s.title, link) }} />
        </li>
      `)}
    </ul>
  `;
}

function List({ canon, unknown }) {
  const [filter, setFilter] = useState("");
  useEffect(() => { setTitle("Опасности"); }, []);
  const words = fold(filter).split(/\s+/).filter(Boolean);
  const shown = canon.hazards.filter((h) => {
    const text = fold([h.name, ...h.traits].join(" "));
    return words.every((w) => text.includes(w));
  });
  return html`
    <section class="page">
      <h1>Опасности</h1>
      ${unknown && html`<p class="bad">Опасности «${unknown}» в каноне нет.</p>`}
      <div class="row">
        <input type="search" placeholder="Название или признак" value=${filter}
               onInput=${(e) => setFilter(e.target.value)} />
        <span class="muted">${shown.length} из ${canon.hazards.length}</span>
      </div>
      ${shown.length > 0 && html`
        <div class="scroll">
          <table class="grid hazards">
            <thead><tr>
              <th>Опасность</th><th>Признаки</th><th>Ур.</th><th>Вид</th><th>Скрытность</th><th>Проверка</th>
            </tr></thead>
            <tbody>
              ${shown.map((h) => html`
                <tr key=${h.id}>
                  <td><a href=${hazardHref(h.id)}>${h.name}</a></td>
                  <td class="muted">${h.traits.filter((t) => t !== "комплексная").join(", ")}</td>
                  <td>${h.level}</td>
                  <td>${h.complex ? "комплексная" : "простая"}</td>
                  <td>${h.stealth ?? "—"}</td>
                  <td>${checks(h)}</td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      `}
      ${shown.length === 0 && html`<p class="muted">Ничего не найдено.</p>`}
      <${Laws} canon=${canon} />
    </section>
  `;
}

export function HazardsPage({ rest }) {
  const { canon, error } = useCanon();
  if (error || !canon) return html`<${CanonState} title="Опасности" error=${error} />`;
  const id = decode(rest);
  const hazard = id && canon.hazards.find((h) => h.id === id);
  if (!hazard) return html`<${List} canon=${canon} unknown=${id} />`;
  return html`<${Card} key=${hazard.id} canon=${canon} hazard=${hazard} />`;
}
