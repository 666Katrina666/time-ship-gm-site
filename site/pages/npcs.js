import { html, useEffect, useMemo, useState } from "../vendor/htm-preact.js";
import { canonLinks, decode, sectionHref, useCanon } from "../canon.js";
import { renderInline } from "../markdown.js";
import { markTermsHtml } from "../terms.js";
import { Picture, useImages } from "../pictures.js";
import { CanonState, More, WhereFound, fold, setTitle } from "../card.js";
import { creatureHref } from "./creatures.js";

// NPC and faction cards of P8, section 20 (canon.npcs, parsed by
// tools/site_npcs.py). "#/canon/npcs" lists them, and "#/canon/npcs/<id>"
// shows one card: its fields as the canon writes them, the sections of the
// "Подробно" line folded on the card, and the way to the NPC's stat block
// card (the block itself is not repeated here). The picture is
// site/img/<id>.* or, failing that, the picture of its creature.

export function npcHref(id) {
  return `#/canon/npcs${id ? `/${encodeURIComponent(id)}` : ""}`;
}

const field = (npc, prefix) => npc.fields.find((f) => f.label.startsWith(prefix))?.text ?? "";
const plain = (text) => text.replace(/\*+/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\.$/, "");

function Fields({ canon, doc, npc }) {
  const rows = useMemo(() => {
    const link = canonLinks(canon, doc);
    return npc.fields.map((f) => ({ ...f, html: markTermsHtml(renderInline(f.text, link), canon) }));
  }, [npc]);
  return html`
    <dl class="fields">
      ${rows.map((f) => html`
        <dt key=${`t:${f.label}`}>${f.label}</dt>
        <dd key=${`d:${f.label}`} dangerouslySetInnerHTML=${{ __html: f.html }} />
      `)}
    </dl>
  `;
}

function Card({ canon, npc: n }) {
  const doc = canon.byId.get(n.doc);
  const creature = n.creature && canon.creatures.find((c) => c.id === n.creature);
  const images = useImages();
  const image = images?.[n.id] ?? (creature && images?.[creature.id]);
  useEffect(() => { setTitle(n.name); scrollTo(0, 0); }, [n]);
  return html`
    <article class=${`sheet${image ? " has-picture" : ""}`}>
      <p class="muted"><a href=${npcHref()}>Все НПС</a></p>
      <header class="sheet-head">
        <h1>${n.name}</h1>
        ${creature && html`
          <a class="level" href=${creatureHref(creature.id)}>
            ${creature.budget ? `Существо ${creature.level}` : `профиль, уровень ${creature.level}`}
          </a>`}
      </header>
      ${image && html`<${Picture} src=${image} alt=${n.name} />`}
      <${Fields} canon=${canon} doc=${doc} npc=${n} />
      <${WhereFound} canon=${canon} kind="npcs" id=${n.id} />
      <p class="row sheet-links">
        ${creature && html`<a class="button" href=${creatureHref(creature.id)}>Блок: ${creature.name}</a>`}
        <a class="button" href=${sectionHref(n.doc, n.key)}>Карточка в ${doc.short.split(".")[0]}</a>
      </p>
      <${More} canon=${canon}
               parts=${n.more.filter((m) => !(creature && m.doc === creature.doc && [creature.key, creature.home].includes(m.key)))} />
      ${images && !image && html`
        <p class="muted">Картинка: положите файл <code>site/img/${n.id}.png</code> (или .jpg, .webp)</p>`}
    </article>
  `;
}

function List({ canon, unknown }) {
  const [filter, setFilter] = useState("");
  useEffect(() => { setTitle("НПС"); }, []);
  const words = fold(filter).split(/\s+/).filter(Boolean);
  const shown = canon.npcs.filter((n) => {
    const text = fold([n.name, field(n, "Тип")].join(" "));
    return words.every((w) => text.includes(w));
  });
  const creatures = new Map(canon.creatures.map((c) => [c.id, c]));
  return html`
    <section class="page">
      <h1>НПС и фракции</h1>
      ${unknown && html`<p class="bad">НПС «${unknown}» в каноне нет.</p>`}
      <div class="row">
        <input type="search" placeholder="Имя или тип" value=${filter}
               onInput=${(e) => setFilter(e.target.value)} />
        <span class="muted">${shown.length} из ${canon.npcs.length}</span>
      </div>
      ${shown.length > 0 && html`
        <div class="scroll">
          <table class="grid npcs">
            <thead><tr><th>НПС</th><th>Тип</th><th>Старт</th><th>Главная цель</th><th>Блок</th></tr></thead>
            <tbody>
              ${shown.map((n) => {
                const c = n.creature && creatures.get(n.creature);
                return html`
                  <tr key=${n.id}>
                    <td><a href=${npcHref(n.id)}>${n.name}</a></td>
                    <td>${plain(field(n, "Тип"))}</td>
                    <td>${plain(field(n, "Старт"))}</td>
                    <td class="muted">${plain(field(n, "Главная"))}</td>
                    <td>${c ? html`<a href=${creatureHref(c.id)}>${c.budget ? `ур. ${c.level}` : `проф. ${c.level}`}</a>` : "—"}</td>
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

export function NpcsPage({ rest }) {
  const { canon, error } = useCanon();
  if (error || !canon) return html`<${CanonState} title="НПС" error=${error} />`;
  const id = decode(rest);
  const npc = id && canon.npcs.find((n) => n.id === id);
  if (!npc) return html`<${List} canon=${canon} unknown=${id} />`;
  return html`<${Card} key=${npc.id} canon=${canon} npc=${npc} />`;
}
