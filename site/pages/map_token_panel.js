import { html, useState } from "../vendor/htm-preact.js";
import { dispatch, useStore } from "../store.js";
import { KIND_WORDS, PARTY, initials, offMapNpcs, tokensOf } from "../tokens.js";
import { npcHref } from "./npcs.js";
import { roomHref } from "./rooms.js";

// The panel "Токены" of the map page (site/pages/map.js): every token with
// its room, a new token by name, an NPC that starts off the map put on it,
// and the token picked to move — the next click on a room of the map moves
// it there. The state is site/tokens.js.

function run(promise, onError) {
  promise.then(() => onError(null), (e) => onError(e.message));
}

export const move = (token, room, onError) => {
  if (token.room !== room) run(dispatch("token-move", { id: token.id, name: token.name, room }), onError);
};

// The mark of a token as on the map.
export function Chip({ token, picked, onPick }) {
  return html`
    <button class=${`token-chip token-${token.kind}${picked ? " picked" : ""}`} aria-pressed=${picked}
            title=${picked ? "Выбран: щёлкните по комнате на карте" : "Выбрать и щёлкнуть по комнате на карте"}
            onClick=${() => onPick(token.id)}>${initials(token.name)}</button>
  `;
}

// A token the GM added has a number for its id; the canon ones have names.
const isAdded = (token) => /^\d+$/.test(token.id);

function TokenRow({ token, rooms, picked, onPick, onError }) {
  const name = token.npc ? html`<a href=${npcHref(token.npc)}>${token.name}</a>` : token.name;
  const onChange = (e) => move(token, e.target.value === "" ? null : Number(e.target.value), onError);
  const start = token.start === null ? "вне карты" : `комната ${token.start}`;
  return html`
    <div class="row token-row">
      <${Chip} token=${token} picked=${picked} onPick=${onPick} />
      <span class="token-name">${name} <span class="muted">${KIND_WORDS[token.kind]}</span></span>
      <select value=${token.room ?? ""} onChange=${onChange} title=${`На старте: ${start}`}>
        <option value="">вне карты</option>
        ${rooms.map((r) => html`<option key=${r.number} value=${r.number}>${r.number}. ${r.title}</option>`)}
      </select>
      ${!isAdded(token) && token.room !== token.start && html`
        <button class="small" title=${`На старте: ${start}`} onClick=${() => move(token, token.start, onError)}>исходное</button>`}
      ${isAdded(token) && html`
        <button class="small" onClick=${() => run(dispatch("token-remove", { id: token.id, name: token.name }), onError)}>удалить</button>`}
    </div>
  `;
}

export function TokenPanel({ canon, map, picked, onPick }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("character");
  const [error, setError] = useState(null);
  const tokens = useStore(() => tokensOf(canon));
  const hidden = useStore(() => offMapNpcs(canon));
  const onMap = new Set(map.nodes.filter((n) => n.room !== undefined).map((n) => n.room));
  const rooms = canon.rooms.filter((r) => onMap.has(r.number));
  const placed = tokens.filter((t) => t.room !== null);
  const away = tokens.filter((t) => t.room === null);
  const party = tokens.find((t) => t.id === PARTY);
  const here = party?.room ?? map.start ?? null;
  const putNpc = (e) => {
    const npc = hidden.find((n) => n.id === e.target.value);
    e.target.value = "";
    if (npc && here !== null) move(npc, here, setError);
  };
  const add = () => {
    const text = name.trim();
    if (!text) return;
    run(dispatch("token-add", { name: text, kind, room: here }), setError);
    setName("");
  };
  const row = (t) => html`
    <${TokenRow} key=${t.id} token=${t} rooms=${rooms} picked=${t.id === picked} onPick=${onPick} onError=${setError} />`;
  return html`
    <section class="card map-tokens">
      <h2>Токены <span class="muted">${placed.length} на карте</span></h2>
      <p class="muted">
        Группа начинает в ${map.start ? html`<a href=${roomHref(map.start)}>комнате ${map.start}</a>` : "комнате, которой канон не назвал"},
        НПС — в комнате из поля «Старт» своей карточки П8, если там номер; остальные НПС ставятся списком внизу. Щелчок по значку выбирает токен,
        следующий щелчок по комнате на карте переносит его туда.
      </p>
      ${placed.map(row)}
      ${away.length > 0 && html`
        <details>
          <summary>Вне карты (${away.length})</summary>
          ${away.map(row)}
        </details>`}
      <div class="row">
        <input value=${name} placeholder="Имя нового токена" onInput=${(e) => setName(e.target.value)}
               onKeyDown=${(e) => { if (e.key === "Enter") add(); }} />
        <select value=${kind} onChange=${(e) => setKind(e.target.value)}>
          <option value="character">персонаж группы</option>
          <option value="other">другое</option>
        </select>
        <button disabled=${!name.trim()} onClick=${add}>Добавить</button>
      </div>
      ${hidden.length > 0 && html`
        <div class="row">
          <select value="" onChange=${putNpc} disabled=${here === null}
                  title="НПС, который начинает вне карты, встаёт в комнату группы">
            <option value="">Поставить НПС (${hidden.length})…</option>
            ${hidden.map((n) => html`<option key=${n.id} value=${n.id}>${n.name}</option>`)}
          </select>
        </div>`}
      ${error && html`<p class="bad">${error}</p>`}
    </section>
  `;
}
