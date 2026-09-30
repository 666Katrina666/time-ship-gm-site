import { html, useEffect, useState } from "../vendor/htm-preact.js";
import { decode, sectionHref, useCanon } from "../canon.js";
import { Picture, useImages } from "../pictures.js";
import { defineSlice, dispatch, getState, useStore } from "../store.js";
import { CanonState, Markdown, Subtree, fold, setTitle } from "../card.js";
import { creatureHref } from "./creatures.js";
import { hazardHref } from "./hazards.js";
import { itemHref } from "./items.js";
import { mapHref } from "./map.js";
import { npcHref } from "./npcs.js";
import { ToScene } from "./scene.js";
import { Entry, Group } from "./world.js";

// Rooms of P13 (canon.rooms, parsed by tools/site_rooms.py). "#/game/rooms"
// lists the 41 rooms, and "#/game/rooms/<number>" shows one: its description
// from the source (tools/site_room_source.py) with the pasted card blocks as
// links to their cards, under it the PF2 overlay of P13 as the canon writes
// it, the room's picture site/img/komnata-N.*, and
// beside it the cards its "Связанные системы" line names (a creature and a
// hazard with "в сцену", as on their cards), the GM's note and
// the fields of the P2 sheet the room uses, in the same panels as on the
// world state page: a field changed here is changed there.
//
// The note is party state: the event "room-note" { room, text } sets it, text
// null drops it. It is keyed by the room's number, as the picture is, so a
// renamed room keeps its note. Like a long sheet note it is sent when the
// field is left or on Ctrl+Enter.

defineSlice("roomNotes", () => ({}), {
  "room-note": (notes, data) => {
    if (data.text === null) delete notes[data.room];
    else notes[data.room] = data.text;
  },
});

export function roomHref(number) {
  return `#/game/rooms${number ? `/${number}` : ""}`;
}

const noteOf = (number) => getState().roomNotes?.[number] ?? null;

// Notes sent but not yet back from the server, as on the world state page.
const pending = new Map();

function saveNote(number, text, onError) {
  const next = text || null;
  if (next === (pending.has(number) ? pending.get(number) : noteOf(number))) return;
  pending.set(number, next);
  dispatch("room-note", { room: number, text: next })
    .catch((e) => onError(e.message))
    .finally(() => { if (pending.get(number) === next) pending.delete(number); });
}

// The cards of a room by kind, in the order its related line names them;
// scene is the kind of combatant a card of that kind enters the scene as.
function cardsOf(canon, room) {
  const find = (list, id) => list.find((c) => c.id === id);
  return [
    { title: "Существа", href: creatureHref, cards: room.creatures.map((id) => find(canon.creatures, id)),
      level: (c) => `Существо ${c.level}`, scene: "creature" },
    { title: "НПС", href: npcHref, cards: room.npcs.map((id) => find(canon.npcs, id)) },
    { title: "Опасности", href: hazardHref, cards: room.hazards.map((id) => find(canon.hazards, id)),
      level: (h) => `${h.complex ? "Комплексная опасность" : "Опасность"} ${h.level}`, scene: "hazard" },
    { title: "Предметы", href: itemHref, cards: room.items.map((id) => find(canon.items, id)) },
  ].map((kind) => ({ ...kind, cards: kind.cards.filter(Boolean) })).filter((kind) => kind.cards.length);
}

// The room's sheet fields grouped as the sheet groups them, groups in the
// order the room first names them.
function groupsOf(canon, room) {
  const groups = [];
  for (const key of room.fields) {
    const group = canon.state.groups.find((g) => g.fields.some((f) => f.key === key));
    if (!group) continue;
    let entry = groups.find((g) => g.group === group);
    if (!entry) groups.push(entry = { group, fields: [] });
    entry.fields.push(group.fields.find((f) => f.key === key));
  }
  return groups;
}

function Cards({ canon, room }) {
  const kinds = cardsOf(canon, room);
  return html`
    <section class="card room-panel">
      <h2>Карточки</h2>
      ${kinds.length === 0 && html`<p class="muted">Строка связей комнаты не называет ни одной карточки.</p>`}
      ${kinds.map((kind) => html`
        <div key=${kind.title} class="room-cards">
          <h3>${kind.title}</h3>
          <ul>
            ${kind.cards.map((c) => html`
              <li key=${c.id}>
                <a href=${kind.href(c.id)}>${c.name}</a>
                ${kind.level && html` <span class="muted">${kind.level(c)}</span>`}
                ${kind.scene && html` <${ToScene} kind=${kind.scene} card=${c} small />`}
              </li>
            `)}
          </ul>
        </div>
      `)}
    </section>
  `;
}

const HREF_OF = { creatures: creatureHref, npcs: npcHref, items: itemHref };
const KIND_OF = { creatures: "существо", npcs: "НПС", items: "предмет" };

// The source description: text as the source writes it, its own subheadings,
// and each pasted card block as a line with a link to the card.
function Source({ canon, doc, room }) {
  if (!room.source) return html`<p class="muted">Комнаты нет в исходнике.</p>`;
  return html`
    <section class="room-source">
      <h2>Исходник</h2>
      ${room.source.parts.map((part, n) => {
        if (part.text) return html`<${Markdown} key=${n} canon=${canon} doc=${doc} text=${part.text} />`;
        if (part.heading) return html`<h3 key=${n}>${part.heading}</h3>`;
        const card = canon[part.kind].find((c) => c.id === part.id);
        return html`
          <p key=${n} class="room-cut muted">
            Блок «${part.cut}» — ${KIND_OF[part.kind]}:
            ${card ? html` <a href=${HREF_OF[part.kind](card.id)}>${card.name}</a>` : ` ${part.id}`}
          </p>
        `;
      })}
    </section>
  `;
}

function Note({ room, onError }) {
  const text = useStore(() => noteOf(room.number));
  const field = { key: `room-${room.number}`, kind: "text", long: true, start: null, label: "Заметка Мастера" };
  return html`
    <section class="card world-group room-panel">
      <h2>Заметки Мастера</h2>
      <div class=${`field wide${text !== null ? " set" : ""}`}>
        <${Entry} key=${room.number} field=${field} value=${text} onError=${onError}
                  save=${(_, value) => saveNote(room.number, value, onError)} />
      </div>
    </section>
  `;
}

function Neighbours({ canon, room }) {
  const byNumber = new Map(canon.rooms.map((r) => [r.number, r]));
  const prev = byNumber.get(room.number - 1);
  const next = byNumber.get(room.number + 1);
  const link = (r) => html`<a href=${roomHref(r.number)}>${r.number}. ${r.title}</a>`;
  return html`
    <p class="muted room-nav">
      <a href=${roomHref()}>Все комнаты</a> · <a href=${mapHref(room.number)}>На карте</a>
      ${prev && html` · ← ${link(prev)}`}
      ${next && html` · ${link(next)} →`}
    </p>
    ${room.neighbours.length > 0 && html`
      <p class="room-links">
        <span class="muted">Связана с:</span>
        ${room.neighbours.map((n) => byNumber.get(n)).filter(Boolean).map((r) => html`<span key=${r.number}>${link(r)}</span>`)}
      </p>
    `}
  `;
}

function Room({ canon, room }) {
  const doc = canon.byId.get(room.doc);
  const images = useImages();
  const image = images?.[room.id];
  const [error, setError] = useState(null);
  useEffect(() => { setTitle(`${room.number}. ${room.title}`); scrollTo(0, 0); setError(null); }, [room]);
  const groups = canon.state ? groupsOf(canon, room) : [];
  return html`
    <article class="room-page">
      <${Neighbours} canon=${canon} room=${room} />
      <header class="sheet-head"><h1>${room.number}. ${room.title}</h1></header>
      ${error && html`<p class="bad">${error}</p>`}
      <div class="room">
        <div class=${`sheet room-main${image ? " has-picture" : ""}`}>
          ${image && html`<${Picture} src=${image} alt=${room.title} />`}
          <${Source} canon=${canon} doc=${doc} room=${room} />
          <${Subtree} canon=${canon} doc=${doc} keyOf=${room.key} level=${1} />
          <p class="row sheet-links">
            <a class="button" href=${sectionHref(room.doc, room.key)}>Открыть в ${doc.short.split(".")[0]}</a>
            ${images && !image && html`<span class="muted">Картинка: положите файл <code>site/img/${room.id}.png</code> (или .jpg, .webp)</span>`}
          </p>
        </div>
        <aside class="room-side">
          <${Cards} canon=${canon} room=${room} />
          <${Note} room=${room} onError=${setError} />
          ${groups.length > 0 && html`
            <h2 class="room-state">Состояние <a href="#/game/world" class="muted">весь лист</a></h2>
            ${groups.map(({ group, fields }) => html`
              <${Group} key=${group.title} canon=${canon} group=${group} fields=${fields} onError=${setError} />
            `)}
          `}
          ${groups.length === 0 && html`<p class="muted">Полей листа П2 комната не называет.</p>`}
        </aside>
      </div>
    </article>
  `;
}

// A filter word matches the title or a card's name, a number matches the room's number.
function matches(canon, room, words) {
  const names = cardsOf(canon, room).flatMap((k) => k.cards.map((c) => c.name));
  const text = fold([room.title, ...names].join(" "));
  return words.every((w) => (/^\d+$/.test(w) ? room.number === Number(w) : text.includes(w)));
}

// "2" with the names in a tooltip, or "—".
function Count({ names }) {
  return names.length ? html`<span title=${names.join(", ")}>${names.length}</span>` : html`<span class="muted">—</span>`;
}

function List({ canon, unknown }) {
  const [filter, setFilter] = useState("");
  const world = useStore(() => getState().world ?? {});
  const notes = useStore(() => getState().roomNotes ?? {});
  useEffect(() => { setTitle("Комнаты"); }, []);
  const words = fold(filter).split(/\s+/).filter(Boolean);
  const shown = canon.rooms.filter((r) => matches(canon, r, words));
  const names = (list, ids) => ids.map((id) => list.find((c) => c.id === id)?.name).filter(Boolean);
  return html`
    <section class="page">
      <h1>Комнаты</h1>
      ${unknown && html`<p class="bad">Комнаты «${unknown}» в каноне нет.</p>`}
      <p class="muted">
        <a href=${sectionHref("p13", "Комнаты 1–41")}>Покомнатная надстройка П13</a>: у каждой комнаты
        её карточки, поля листа состояния и заметки Мастера.
      </p>
      <div class="row">
        <input type="search" placeholder="Номер, название или карточка" value=${filter}
               onInput=${(e) => setFilter(e.target.value)} />
        <span class="muted">${shown.length} из ${canon.rooms.length}</span>
      </div>
      ${shown.length > 0 && html`
        <div class="scroll">
          <table class="grid rooms">
            <thead><tr>
              <th>№</th><th>Комната</th><th>Существа</th><th>НПС</th><th>Опасности</th><th>Предметы</th>
              <th title="Изменено партией из полей листа, которые называет комната">Поля</th><th>Заметка</th>
            </tr></thead>
            <tbody>
              ${shown.map((r) => html`
                <tr key=${r.number}>
                  <td>${r.number}</td>
                  <td><a href=${roomHref(r.number)}>${r.title}</a></td>
                  <td><${Count} names=${names(canon.creatures, r.creatures)} /></td>
                  <td><${Count} names=${names(canon.npcs, r.npcs)} /></td>
                  <td><${Count} names=${names(canon.hazards, r.hazards)} /></td>
                  <td><${Count} names=${names(canon.items, r.items)} /></td>
                  <td>${r.fields.length
                    ? `${r.fields.filter((k) => k in world).length} / ${r.fields.length}`
                    : html`<span class="muted">—</span>`}</td>
                  <td>${r.number in notes ? "есть" : html`<span class="muted">—</span>`}</td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      `}
      ${shown.length === 0 && html`<p class="muted">Ничего не найдено.</p>`}
    </section>
  `;
}

export function RoomsPage({ rest }) {
  const { canon, error } = useCanon();
  if (error || !canon) return html`<${CanonState} title="Комнаты" error=${error} />`;
  const id = decode(rest);
  const room = /^\d+$/.test(id) && canon.rooms.find((r) => r.number === Number(id));
  if (!room) return html`<${List} canon=${canon} unknown=${id} />`;
  return html`<${Room} key=${room.number} canon=${canon} room=${room} />`;
}
