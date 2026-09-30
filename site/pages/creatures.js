import { html, useEffect, useMemo, useState } from "../vendor/htm-preact.js";
import { canonLinks, decode, sectionHref, useCanon } from "../canon.js";
import { renderInline } from "../markdown.js";
import { Picture, useImages } from "../pictures.js";
import { Ability, CanonState, Info, Markdown, Traits, WhereFound, fold, setTitle, signed } from "../card.js";
import { Layers } from "./items.js";
import { ToScene } from "./scene.js";

// Creatures of the P9 and P11 stat blocks (canon.creatures, parsed by
// tools/site_creatures.py). "#/canon/creatures" lists them, and
// "#/canon/creatures/<id>" shows one card: the block as the canon writes it,
// its abilities, the rest folded, and the GM's picture site/img/<id>.* if
// there is one (pictures.js places it by its proportions). A creature whose
// body parts P12 studies (the Dog, the Posthuman) shows their knowledge
// layers with the players' marks, as an item card does.

export function creatureHref(id) {
  return `#/canon/creatures${id ? `/${encodeURIComponent(id)}` : ""}`;
}

function Card({ canon, creature: c }) {
  const doc = canon.byId.get(c.doc);
  const images = useImages();
  const image = images?.[c.id];
  useEffect(() => { setTitle(c.name); scrollTo(0, 0); }, [c]);
  const parts = useMemo(() => c.parts && { ...c.parts, id: c.id, name: `${c.name}, части тела` }, [c]);
  const header = [c.classification, c.role].filter(Boolean).join(" · ");
  // The NPC cards whose block this is (npcs.js imports this module, so the
  // href is written here rather than imported).
  const npcs = canon.npcs.filter((n) => n.creature === c.id);
  // A creature that is also an item (the Jaw) shares its id with the item card.
  const item = canon.items.find((i) => i.id === c.id);
  return html`
    <article class=${`sheet${image ? " has-picture" : ""}`}>
      <p class="muted"><a href=${creatureHref()}>Все существа</a></p>
      <header class="sheet-head">
        <h1>${c.name}</h1>
        <span class="level">${c.budget ? `Существо ${c.level}` : `профиль, уровень ${c.level}`}</span>
      </header>
      ${c.note && html`<p class="muted" dangerouslySetInnerHTML=${{ __html: renderInline(c.note, () => null) }} />`}
      ${c.traits.length > 0 && html`<${Traits} canon=${canon} traits=${c.traits} />`}
      ${header && html`<p class="muted" dangerouslySetInnerHTML=${{ __html: renderInline(header, canonLinks(canon, doc)) }} />`}
      <div class="sheet-top">
        ${image && html`<${Picture} src=${image} alt=${c.name} />`}
        ${c.intro && html`<${Markdown} canon=${canon} doc=${doc} text=${c.intro} />`}
      </div>
      <div class="statblock"><${Markdown} canon=${canon} doc=${doc} text=${c.body} /></div>
      ${c.abilities.map((part) => html`<${Ability} key=${part.key} canon=${canon} doc=${doc} part=${part} />`)}
      ${c.info.length > 0 && html`
        <h2>Сведения</h2>
        ${c.info.map((part) => html`<${Info} key=${part.key} canon=${canon} doc=${doc} part=${part} />`)}
      `}
      ${parts && html`
        <${Layers} canon=${canon} doc=${canon.byId.get(parts.doc)} item=${parts} title="Части тела: слои знаний" />
        <p class="muted">Это не предметы: части работают только в теле. Подробно — <a href=${sectionHref(parts.doc, parts.key)}>П12</a>.</p>
      `}
      <${WhereFound} canon=${canon} kind="creatures" id=${c.id} />
      <p class="row sheet-links">
        ${c.budget && html`<${ToScene} kind="creature" card=${c} />`}
        ${npcs.map((n) => html`<a key=${n.id} class="button" href=${`#/canon/npcs/${encodeURIComponent(n.id)}`}>НПС: ${n.name}</a>`)}
        ${item && html`<a class="button" href=${`#/canon/items/${encodeURIComponent(item.id)}`}>Предмет: ${item.name}</a>`}
        <a class="button" href=${sectionHref(c.doc, c.home)}>Открыть в ${doc.short.split(".")[0]}</a>
        ${c.aon && html`<a class="button" href=${c.aon.href} target="_blank" rel="noopener">${c.aon.title.replace(/\*/g, "")} на AoN</a>`}
        ${images && !image && html`<span class="muted">Картинка: положите файл <code>site/img/${c.id}.png</code> (или .jpg, .webp)</span>`}
      </p>
    </article>
  `;
}

function List({ canon, unknown }) {
  const [filter, setFilter] = useState("");
  useEffect(() => { setTitle("Существа"); }, []);
  const words = fold(filter).split(/\s+/).filter(Boolean);
  const shown = canon.creatures.filter((c) => {
    const text = fold([c.name, ...c.traits].join(" "));
    return words.every((w) => text.includes(w));
  });
  const groups = canon.docs.filter((d) => shown.some((c) => c.doc === d.id));
  return html`
    <section class="page">
      <h1>Существа</h1>
      ${unknown && html`<p class="bad">Существа «${unknown}» в каноне нет.</p>`}
      <div class="row">
        <input type="search" placeholder="Имя или признак" value=${filter}
               onInput=${(e) => setFilter(e.target.value)} />
        <span class="muted">${shown.length} из ${canon.creatures.length}</span>
      </div>
      ${groups.map((d) => html`
        <h2 key=${d.id}>${d.short}</h2>
        <div class="scroll">
          <table class="grid creatures">
            <thead><tr>
              <th>Существо</th><th>Признаки</th><th>Ур.</th><th>КБ</th><th>ПЗ</th>
              <th>Восп.</th><th>Стойк.</th><th>Реф.</th><th>Воля</th>
            </tr></thead>
            <tbody>
              ${shown.filter((c) => c.doc === d.id).map((c) => html`
                <tr key=${c.id}>
                  <td><a href=${creatureHref(c.id)}>${c.name}</a></td>
                  <td class="muted">${c.traits.join(", ")}</td>
                  <td title=${c.budget ? "" : "профиль: не считается существом для бюджета столкновения"}>
                    ${c.level}${c.budget ? "" : "*"}
                  </td>
                  <td>${c.numbers.ac ?? "—"}</td>
                  <td>${c.numbers.hp ?? "—"}</td>
                  <td>${signed(c.numbers.perception)}</td>
                  <td>${signed(c.numbers.fort)}</td>
                  <td>${signed(c.numbers.ref)}</td>
                  <td>${signed(c.numbers.will)}</td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      `)}
      ${shown.length === 0 && html`<p class="muted">Ничего не найдено.</p>`}
    </section>
  `;
}

export function CreaturesPage({ rest }) {
  const { canon, error } = useCanon();
  if (error || !canon) return html`<${CanonState} title="Существа" error=${error} />`;
  const id = decode(rest);
  const creature = id && canon.creatures.find((c) => c.id === id);
  if (!creature) return html`<${List} canon=${canon} unknown=${id} />`;
  return html`<${Card} key=${creature.id} canon=${canon} creature=${creature} />`;
}
