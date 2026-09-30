import { html, useEffect, useState } from "../vendor/htm-preact.js";
import { useCanon } from "../canon.js";
import { CanonState, setTitle, signed } from "../card.js";
import { rollDie } from "../encounters.js";
import { dispatch, getState, useStore } from "../store.js";
import { addToScene, fromCard, fromCharacter, inScene, ordered } from "../scene.js";
import { hitPoints, partyState } from "../party.js";
import { creatureHref } from "./creatures.js";
import { hazardHref } from "./hazards.js";

// The combat scene (site/scene.js): who is in the fight, initiative order,
// each instance's hit points and conditions. Creatures and hazards come from
// their cards here or by the "В сцену" buttons of the cards, the room pages
// and the random encounters; the party's characters by their buttons here
// and on "Вы сами", anyone else by name.

const HREF = { creature: creatureHref, hazard: hazardHref };

// Glossary conditions: { name without " N", valued, index } for the tooltip.
export function conditionsOf(canon) {
  return canon.terms.conditions.items.map((item, index) => ({
    name: item.name.replace(/ N$/, ""), valued: item.name.endsWith(" N"), index,
  }));
}

function run(promise, onError) {
  promise.catch((e) => onError(e.message));
}

// "В сцену" of a creature or hazard card: one more instance each click.
// small: the button of a list line, as in the cards of a room page.
export function ToScene({ kind, card, small = false }) {
  const [done, setDone] = useState(false);
  const add = () => addToScene([fromCard(kind, card)]).then(() => setDone(true), (e) => alert(e.message));
  const label = done ? "В сцене +1" : "В сцену";
  return html`<button class=${small ? "small" : ""} onClick=${add} title="Добавить экземпляр в сцену боя"
                      >${small ? label.toLowerCase() : label}</button>`;
}

// Picks a creature or a hazard by name: "Пёс · существо 3".
function AddCard({ canon, onError }) {
  const [text, setText] = useState("");
  const [count, setCount] = useState(1);
  const cards = [
    ...canon.creatures.map((c) => ({ kind: "creature", card: c, label: `${c.name} · существо ${c.level}` })),
    ...canon.hazards.map((h) => ({ kind: "hazard", card: h, label: `${h.name} · опасность ${h.level}` })),
  ];
  const found = cards.find((c) => c.label === text || c.card.name === text);
  const add = () => {
    if (!found) return;
    run(addToScene(Array.from({ length: count }, () => fromCard(found.kind, found.card))), onError);
    setText("");
    setCount(1);
  };
  return html`
    <div class="row">
      <input list="scene-cards" placeholder="Существо или опасность" value=${text} size="32"
             onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && add()} />
      <datalist id="scene-cards">${cards.map((c) => html`<option key=${c.label} value=${c.label} />`)}</datalist>
      <input type="number" min="1" max="12" value=${count} class="narrow" aria-label="Сколько"
             onInput=${(e) => setCount(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} />
      <button disabled=${!found} onClick=${add}>Добавить</button>
    </div>
  `;
}

// The party's characters not in the scene yet, one by one or all at once.
function AddParty({ scene, onError }) {
  const { list } = useStore(partyState);
  const out = list.filter((pc) => !inScene(scene, pc));
  if (list.length === 0) {
    return html`<p class="muted">Персонажей партии нет: их добавляет <a href="#/tools/pathbuilder">импорт из Pathbuilder</a>.</p>`;
  }
  if (out.length === 0) return null;
  const add = (pcs) => run(addToScene(pcs.map(fromCharacter)), onError);
  return html`
    <div class="row">
      <span class="muted">Партия:</span>
      ${out.map((pc) => html`<button key=${pc.id} class="small" onClick=${() => add([pc])}>${pc.build.name}</button>`)}
      ${out.length > 1 && html`<button class="small" onClick=${() => add(out)}>вся партия (${out.length})</button>`}
    </div>
  `;
}

// Anyone without a card or a sheet: a name for the initiative order.
function AddOther({ onError }) {
  const [name, setName] = useState("");
  const add = () => {
    if (!name.trim()) return;
    run(addToScene([{ kind: "other", ref: null, name: name.trim(), max: null, mod: null }]), onError);
    setName("");
  };
  return html`
    <div class="row">
      <input placeholder="Кто-то ещё без карточки (имя)" value=${name} size="32"
             onInput=${(e) => setName(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && add()} />
      <button disabled=${!name.trim()} onClick=${add}>Добавить</button>
    </div>
  `;
}

// A number field sent on leave or Enter.
function NumberField({ value, onCommit, label }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  const commit = (raw) => {
    const next = raw === "" ? null : Number(raw);
    if (next !== value && (next === null || Number.isFinite(next))) onCommit(next);
  };
  return html`
    <input type="number" class="narrow" value=${draft} aria-label=${label}
           onInput=${(e) => setDraft(e.target.value)} onBlur=${(e) => commit(e.target.value)}
           onKeyDown=${(e) => e.key === "Enter" && e.target.blur()} />
  `;
}

// Hit points: the current value and a field for damage or healing;
// onChange gets the signed amount. Also the quick fields of "Вы сами".
export function HitPoints({ hp, max, onChange }) {
  const [amount, setAmount] = useState("");
  if (max === null) return html`<span class="muted">—</span>`;
  const apply = (sign) => {
    const n = Math.abs(Number(amount));
    if (!n) return;
    onChange(sign * n);
    setAmount("");
  };
  return html`
    <span class="scene-hp">
      <strong>${hp}</strong><span class="muted">/${max}</span>
      <input type="number" min="1" class="narrow" value=${amount} aria-label="Сколько ПЗ"
             onInput=${(e) => setAmount(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && apply(-1)} />
      <button class="small" title="Урон (Enter)" onClick=${() => apply(-1)}>урон</button>
      <button class="small" title="Лечение" onClick=${() => apply(1)}>лечение</button>
    </span>
  `;
}

// The conditions someone has (current: { name: value }) and a list to add
// one from the glossary; onSet(condition, value) with value null to take it
// off. Also the quick fields of "Вы сами".
export function Conditions({ current, conditions, onSet }) {
  const add = (e) => {
    const cond = conditions.find((x) => x.name === e.target.value);
    e.target.value = "";
    if (!cond) return;
    const had = current[cond.name];
    onSet(cond.name, cond.valued ? (had ?? 0) + 1 : true);
  };
  return html`
    <div class="scene-conditions">
      ${Object.entries(current).map(([name, value]) => {
        const cond = conditions.find((x) => x.name === name);
        return html`
          <span key=${name} class="trait">
            <span class=${cond ? "term" : ""} data-term=${cond && `c:${cond.index}`}>${name}${value === true ? "" : ` ${value}`}</span>
            ${value !== true && html`
              <button class="small" title="Меньше на 1" onClick=${() => onSet(name, value > 1 ? value - 1 : null)}>−</button>
              <button class="small" title="Больше на 1" onClick=${() => onSet(name, value + 1)}>+</button>`}
            <button class="small" title="Снять" onClick=${() => onSet(name, null)}>×</button>
          </span>
        `;
      })}
      <select aria-label="Добавить состояние" onChange=${add}>
        <option value="">+ состояние</option>
        ${conditions.map((x) => html`<option key=${x.name} value=${x.name}>${x.name}${x.valued ? " N" : ""}</option>`)}
      </select>
    </div>
  `;
}

// What a row shows of a combatant: from its card, from the party for a
// character, nothing for anyone else. hp and conditions come with handlers,
// so a character's are changed by the party's events.
function viewOf(canon, party, c, onError) {
  const send = (type, data) => run(dispatch(type, data), onError);
  if (c.kind === "pc") {
    const pc = party.list.find((x) => x.id === c.ref);
    if (!pc) return { name: c.name, note: "нет в партии", hp: null, max: null, conditions: null };
    const n = pc.build.numbers;
    const { hp, max } = hitPoints(pc);
    const who = { id: pc.id, name: pc.build.name };
    return {
      name: html`<a href="#/game/yourselves">${c.name}</a>`, note: `персонаж ${pc.build.level}`,
      ac: n.ac, hp, max, saves: `Стойк. ${signed(n.fortitude)} · Реф. ${signed(n.reflex)} · Воля ${signed(n.will)}`,
      conditions: pc.conditions,
      onHp: (delta) => send("pc-hp", { ...who, delta }),
      onCondition: (condition, value) => send("pc-condition", { ...who, condition, value }),
    };
  }
  const card = c.kind === "creature" ? canon.creatures.find((x) => x.id === c.ref)
    : c.kind === "hazard" ? canon.hazards.find((x) => x.id === c.ref) : null;
  const n = card?.numbers || {};
  return {
    name: card ? html`<a href=${HREF[c.kind](card.id)}>${c.name}</a>` : c.name,
    note: card && `${c.kind === "hazard" ? "опасность" : "существо"} ${card.level}`,
    ac: n.ac, hp: c.hp, max: c.max,
    saves: n.fort === undefined ? null : `Стойк. ${signed(n.fort)} · Реф. ${signed(n.ref)}${n.will === undefined ? "" : ` · Воля ${signed(n.will)}`}`,
    conditions: c.conditions,
    onHp: (delta) => send("scene-hp", { id: c.id, name: c.name, delta }),
    onCondition: (condition, value) => send("scene-condition", { id: c.id, name: c.name, condition, value }),
  };
}

function Row({ canon, party, c, active, conditions, onError }) {
  const v = viewOf(canon, party, c, onError);
  const down = v.max !== null && v.hp === 0;
  return html`
    <tr class=${[active && "scene-active", down && "scene-down"].filter(Boolean).join(" ")}>
      <td>${active ? "▶" : ""}</td>
      <td>
        <${NumberField} value=${c.init} label="Инициатива"
          onCommit=${(value) => run(dispatch("scene-init", { list: [{ id: c.id, name: c.name, value }] }), onError)} />
        ${c.mod !== null && html`<div class="muted" title=${c.kind === "hazard" ? "Скрытность" : "Восприятие"}>${signed(c.mod)}</div>`}
      </td>
      <td>
        ${v.name}
        ${v.note && html`<div class="muted">${v.note}</div>`}
      </td>
      <td>${v.ac ?? "—"}</td>
      <td><${HitPoints} hp=${v.hp} max=${v.max} onChange=${v.onHp} /></td>
      <td class="muted">${v.saves ?? "—"}</td>
      <td>${v.conditions && html`<${Conditions} current=${v.conditions} conditions=${conditions} onSet=${v.onCondition} />`}</td>
      <td>
        <button class="small" title="Убрать из сцены"
                onClick=${() => run(dispatch("scene-remove", { id: c.id, name: c.name }), onError)}>убрать</button>
      </td>
    </tr>
  `;
}

export function ScenePage() {
  const { canon, error: canonError } = useCanon();
  const scene = useStore(() => getState().scene);
  const party = useStore(partyState);
  const [error, setError] = useState(null);
  useEffect(() => { setTitle("Сцена"); }, []);
  if (canonError || !canon) return html`<${CanonState} title="Сцена" error=${canonError} />`;

  const order = ordered(scene.list);
  const conditions = conditionsOf(canon);
  const unrolled = scene.list.filter((c) => c.init === null && c.mod !== null);
  const rollAll = () => run(dispatch("scene-init", {
    list: unrolled.map((c) => ({ id: c.id, name: c.name, value: rollDie(20) + c.mod })),
  }), setError);
  // Clicks send the turn they see, so a double click is the same event twice, not two turns.
  const next = () => {
    const at = order.findIndex((c) => c.id === scene.active);
    const wrap = scene.active === null || at === order.length - 1;
    const c = order[wrap || at === -1 ? 0 : at + 1];
    run(dispatch("scene-turn", { id: c.id, name: c.name, round: wrap ? scene.round + 1 : scene.round }), setError);
  };
  const clear = () => {
    if (confirm("Завершить сцену? Все участники уйдут из неё; отменить можно из журнала.")) {
      run(dispatch("scene-clear", {}), setError);
    }
  };
  return html`
    <section class="page">
      <h1>Сцена</h1>
      <${AddCard} canon=${canon} onError=${setError} />
      <${AddParty} scene=${scene} onError=${setError} />
      <${AddOther} onError=${setError} />
      ${order.length === 0
        ? html`<p class="muted">В сцене никого. Существ и опасности можно добавить и кнопкой «В сцену» на их карточках и в случайных встречах.</p>`
        : html`
          <div class="row">
            <strong>${scene.round ? `Раунд ${scene.round}` : "Бой не начат"}</strong>
            <button onClick=${next}>${scene.round ? "Следующий ход" : "Начать бой"}</button>
            ${unrolled.length > 0 && html`
              <button title="d20 + Восприятие (у опасности — Скрытность) всем, у кого инициативы ещё нет; игроки бросают сами, их результат вписывается в поле" onClick=${rollAll}>
                Бросить инициативу (${unrolled.length})
              </button>`}
            <button onClick=${clear}>Завершить сцену</button>
          </div>
          <div class="scroll">
            <table class="grid scene">
              <thead><tr>
                <th></th><th>Иниц.</th><th>Участник</th><th>КБ</th><th>ПЗ</th><th>Спасброски</th><th>Состояния</th><th></th>
              </tr></thead>
              <tbody>
                ${order.map((c) => html`
                  <${Row} key=${c.id} canon=${canon} party=${party} c=${c} active=${c.id === scene.active}
                          conditions=${conditions} onError=${setError} />
                `)}
              </tbody>
            </table>
          </div>
        `}
      ${error && html`<p class="bad">${error}</p>`}
    </section>
  `;
}
