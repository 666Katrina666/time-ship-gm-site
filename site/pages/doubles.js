import { html, useEffect, useState } from "../vendor/htm-preact.js";
import { sectionHref, useCanon } from "../canon.js";
import { CanonState, setTitle } from "../card.js";
import { dispatch, undo, useStore } from "../store.js";
import {
  COLLAPSE_AT, DISCHARGE, ERAS, FIELDS, GONE_REASONS, OBJECT_FIELDS, checkEvent, cultPairs, doublesState, liveVersions,
  nextPair, objectLabel, pairsOf, placeOf, rollObservation, rollPair, tied, versionLabel,
} from "../doubles.js";
import { rollDie } from "../encounters.js";
import { partyState } from "../party.js";
import { hazardHref } from "./hazards.js";
import { itemHref } from "./items.js";
import { ToScene } from "./scene.js";

// "Игра → Временные дубли": the registry of site/doubles.js. The GM enters an
// object and its versions with the fields of P6, 6.7; the page lists the
// pairs of live versions in the order of topic 1.18. "совместно
// наблюдались" checks the unchecked pairs of the versions seen (P6, 7.4) and
// lists the checks, a collapse with its P7 discharge.

export function doublesHref() {
  return "#/game/doubles";
}

function run(promise, onError) {
  promise.catch((e) => onError(e.message));
}

// One after another: each check is its own event, in the order of topic 1.18.
async function sendChecks(events) {
  for (const event of events) await dispatch("double-check", event);
}

const p6 = (key) => sectionHref("p6", key);

// Field names that differ between two records, as the journal writes them.
const changedOf = (names, before, after) =>
  Object.keys(names).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)).map((k) => names[k]);

// Name, canon item and note of an object; a new one when object is null.
function ObjectForm({ canon, object, onDone, onError }) {
  const [name, setName] = useState(object?.name ?? "");
  const [item, setItem] = useState(object?.item ?? "");
  const [note, setNote] = useState(object?.note ?? "");
  const pick = (id) => {
    setItem(id);
    // A canon item names the object unless the GM already named it.
    const found = canon.items.find((i) => i.id === id);
    if (found && !name.trim()) setName(found.name);
  };
  const submit = (e) => {
    e.preventDefault();
    const fields = { name: name.trim(), item: item || null, note: note.trim() || null };
    if (!fields.name) return;
    const changed = object ? changedOf(OBJECT_FIELDS, object, fields) : [];
    if (object && changed.length === 0) return onDone();
    const number = object?.number ?? doublesState().count + 1;
    run(dispatch("double-object", { id: object?.id ?? null, number, ...fields, changed }), onError);
    if (!object) {
      setName("");
      setItem("");
      setNote("");
    }
    onDone();
  };
  return html`
    <form class="double-form" onSubmit=${submit}>
      <div class="row">
        <input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Предмет: «Кристалл из 39», «меч Sir Cider»"
               aria-label="Название объекта" />
        <select value=${item} onChange=${(e) => pick(e.target.value)} aria-label="Предмет канона">
          <option value="">не из П12</option>
          ${canon.items.map((i) => html`<option key=${i.id} value=${i.id}>${i.name}</option>`)}
        </select>
      </div>
      <div class="row">
        <input value=${note} onInput=${(e) => setNote(e.target.value)} placeholder="Заметка: что это за вещь и откуда версии" aria-label="Заметка" />
        <button type="submit" disabled=${!name.trim()}>${object ? "сохранить" : "завести объект"}</button>
        ${object && html`<button type="button" onClick=${onDone}>отмена</button>`}
      </div>
    </form>
  `;
}

const blankVersion = (o) => ({
  era: ERAS[0],
  order: Math.max(0, ...o.versions.map((v) => v.order)) + 1,
  origin: "", carrier: null, where: "", hidden: false, residue: false, echo: false,
});

// The fields of P6, 6.7 for a version; a new one when version is null.
function VersionForm({ object: o, version, onDone, onError }) {
  const party = useStore(() => partyState().list);
  const [f, setF] = useState(() => ({ ...(version ?? blankVersion(o)) }));
  const set = (key, value) => setF((x) => ({ ...x, [key]: value }));
  const pickCarrier = (id) => {
    const pc = party.find((x) => String(x.id) === id);
    set("carrier", pc ? { id: pc.id, name: pc.build.name } : null);
  };
  const submit = (e) => {
    e.preventDefault();
    const fields = {
      era: f.era.trim(), order: Math.floor(Number(f.order) || 1), origin: f.origin.trim(),
      carrier: f.carrier, where: f.where.trim(), hidden: f.hidden, residue: f.residue, echo: f.echo,
    };
    const changed = version ? changedOf(FIELDS, version, fields) : [];
    if (version && changed.length === 0) return onDone();
    const label = `В${version?.number ?? o.count + 1}`;
    run(dispatch("double-version", {
      object: o.id, id: version?.id ?? null, number: o.number, name: o.name, label, fields, changed,
    }), onError);
    onDone();
  };
  // A carrier no longer in the party stays chosen under their name.
  const gone = f.carrier && !party.some((pc) => pc.id === f.carrier.id);
  const check = (key, label, title) => html`
    <label title=${title}><input type="checkbox" checked=${f[key]} onChange=${() => set(key, !f[key])} /> ${label}</label>`;
  return html`
    <form class="double-form card" onSubmit=${submit}>
      <h3>${version ? `Версия ${versionLabel(o, version)}` : "Новая версия"}</h3>
      <div class="double-fields">
        <label>Эпоха
          <input list="double-eras" value=${f.era} onInput=${(e) => set("era", e.target.value)} />
        </label>
        <label title="Личный порядок на мировой линии предмета: 1 — самая ранняя. Равные числа — версии, которые не упорядочить (П6, 7.9)">
          Порядок
          <input type="number" min="1" class="narrow" value=${f.order} onInput=${(e) => set("order", e.target.value)} />
        </label>
        <label class="wide">Как попала в это время
          <input value=${f.origin} onInput=${(e) => set("origin", e.target.value)}
                 placeholder="Унесли из 41; снята с хронопризрака; осталась на теле" />
        </label>
        <label>У кого
          <select value=${f.carrier ? String(f.carrier.id) : ""} onChange=${(e) => pickCarrier(e.target.value)}>
            <option value="">ни у кого</option>
            ${party.map((pc) => html`<option key=${pc.id} value=${String(pc.id)}>${pc.build.name}${pc.out ? " (выбыл)" : ""}</option>`)}
            ${gone && html`<option value=${String(f.carrier.id)}>${f.carrier.name} (нет в партии)</option>`}
          </select>
        </label>
        <label>Где
          <input value=${f.where} onInput=${(e) => set("where", e.target.value)} placeholder="Комната, тайник, сумка" />
        </label>
      </div>
      <div class="row">
        ${check("hidden", "в закрытом непрозрачном контейнере", "Пока версия скрыта, совместного наблюдения нет (П6, 6.6)")}
        ${check("residue", "временной остаток", "Осталась от отменённой истории (П6, 2.2)")}
        ${check("echo", "вещь эха", "За хрустальными стенами исчезает вместе с природой эха (П6, 9.8)")}
      </div>
      <div class="row">
        <button type="submit" disabled=${!f.era.trim()}>${version ? "сохранить" : "добавить версию"}</button>
        <button type="button" onClick=${onDone}>отмена</button>
      </div>
    </form>
  `;
}

// "версия ушла": the reason, then the version stays marked, without pairs.
function GoneForm({ object: o, version: v, onDone, onError }) {
  const [reason, setReason] = useState(GONE_REASONS[0]);
  const send = () => {
    run(dispatch("double-version-gone", {
      object: o.id, id: v.id, number: o.number, name: o.name, label: `В${v.number}`,
      reason, turn: partyState().turn,
    }), onError);
    onDone();
  };
  return html`
    <span class="double-gone-form">
      <select value=${reason} onChange=${(e) => setReason(e.target.value)} aria-label="Почему ушла">
        ${GONE_REASONS.map((r) => html`<option key=${r} value=${r}>${r}</option>`)}
      </select>
      <button class="small" onClick=${send}>ушла</button>
      <button class="small" onClick=${onDone}>отмена</button>
    </span>
  `;
}

function Marks({ v }) {
  const marks = [
    v.hidden && "в контейнере",
    v.residue && "временной остаток",
    v.echo && "вещь эха",
  ].filter(Boolean);
  return marks.length > 0 ? marks.join(", ") : html`<span class="muted">—</span>`;
}

function VersionRow({ object: o, version: v, onEdit, onError }) {
  const [leaving, setLeaving] = useState(false);
  const party = useStore(() => partyState().list);
  const away = v.carrier && !party.some((pc) => pc.id === v.carrier.id);
  const remove = () => {
    if (confirm(`Удалить ${versionLabel(o, v)} из реестра? Если версия исчезла в игре, лучше «ушла».`)) {
      run(dispatch("double-version-remove", { object: o.id, id: v.id, number: o.number, name: o.name, label: `В${v.number}` }), onError);
    }
  };
  return html`
    <tr class=${v.gone ? "gone" : ""}>
      <td><strong>В${v.number}</strong></td>
      <td>${v.era}</td>
      <td>${v.order}</td>
      <td>${v.origin || html`<span class="muted">—</span>`}</td>
      <td>${placeOf(v) || html`<span class="muted">—</span>`}${away && html` <span class="bad">нет в партии</span>`}</td>
      <td><${Marks} v=${v} /></td>
      <td class="double-actions">
        ${v.gone
          ? html`<span class="bad">${v.gone.into ? `коллапс, осталась ${v.gone.into}` : v.gone.reason}, ход ${v.gone.turn}</span>
              <button class="small" onClick=${() => run(undo(v.gone.seq), onError)}
                      title=${v.gone.into
                        ? "Отменяет проверку коллапса этой пары; то же, что отмена записи в журнале"
                        : "Уход был ошибкой; то же, что отмена записи в журнале"}>вернуть</button>`
          : leaving
            ? html`<${GoneForm} object=${o} version=${v} onDone=${() => setLeaving(false)} onError=${onError} />`
            : html`
              <button class="small" onClick=${() => onEdit(v)}>изменить</button>
              <button class="small" title="Версия исчезла, уничтожена или переписана историей: её пары снимаются без проверки"
                      onClick=${() => setLeaving(true)}>ушла</button>
              <button class="small" onClick=${remove}>удалить</button>`}
      </td>
    </tr>
  `;
}

// Pairs whose check may come: both versions out of a container (P6, 6.6).
const visible = ({ a, b }) => !a.hidden && !b.hidden;

function Pairs({ object: o, onObserve }) {
  const pairs = pairsOf(o);
  if (pairs.length === 0) {
    const why = liveVersions(o).length === 0 ? "живых версий нет" : "одна живая версия — ещё не дубль";
    return html`<p class="muted">Пар нет: ${why} (<a href=${p6("6.1. Определение")}>П6, 6.1</a>).</p>`;
  }
  const open = pairs.filter((p) => !p.check && visible(p));
  // A set of versions seen together: all live ones out of a container.
  const all = () => onObserve(liveVersions(o).filter((v) => !v.hidden).map((v) => v.id));
  return html`
    <div class="row double-head">
      <h3>Пары${pairs.length > 2 ? html` <span class="muted">— в порядке проверки (<a href=${p6("7.4. Один бросок на пару")}>П6, 7.4</a>)</span>` : ""}</h3>
      ${open.length > 1 && html`<button class="small" onClick=${all}
        title="Несколько версий видны вместе: непроверенные пары по порядку">совместно наблюдались…</button>`}
    </div>
    <ul class="double-pairs">
      ${pairs.map((p) => {
        const { a, b, key, check } = p;
        const hidden = [a, b].filter((v) => v.hidden);
        return html`
          <li key=${key}>
            <strong>${versionLabel(o, a)} ↔ ${versionLabel(o, b)}</strong>
            ${check
              ? html` — устойчиво <span class="muted">(d100 ${check.roll}, ход ${check.turn})</span>`
              : html`<span class="muted"> — не проверена</span>`}
            ${!check && hidden.length > 0 && html`<span class="muted">; ${hidden.map((v) => `В${v.number}`).join(" и ")} в контейнере — совместного наблюдения нет</span>`}
            ${!check && visible(p) && html` <button class="small" onClick=${() => onObserve([a.id, b.id])}>совместно наблюдались</button>`}
          </li>`;
      })}
    </ul>
  `;
}

// "совместно наблюдались": the versions seen together and the checks of their
// unchecked pairs, rolled here one by one or to the end, or typed in.
function ObserveForm({ object: o, seen: initial, onDone, onError }) {
  const [seen, setSeen] = useState(() => new Set(initial));
  const [roll, setRoll] = useState("");
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const live = liveVersions(o);
  const pair = nextPair(o, seen);
  const shown = live.filter((v) => seen.has(v.id) && !v.hidden);
  // Collapses drop pairs, so this is the most the checks may take.
  const left = pairsOf(o).filter((p) => !p.check && visible(p) && seen.has(p.a.id) && seen.has(p.b.id)).length;
  const toggle = (id) => setSeen((s) => {
    const next = new Set(s);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const r = Number(roll);
  const okRoll = roll !== "" && Number.isInteger(r) && r >= 1 && r <= 100;
  const collapse = okRoll && r <= COLLAPSE_AT;
  const picked = pair && [pair.a, pair.b].find((v) => String(v.id) === pick);
  const needPick = collapse && pair && tied(pair);
  const send = (events) => {
    setBusy(true);
    run(sendChecks(events).finally(() => setBusy(false)), onError);
    setRoll("");
    setPick("");
  };
  const submit = (e) => {
    e.preventDefault();
    if (!pair || !okRoll || (needPick && !picked)) return;
    send([checkEvent(o, pair, { roll: r, entered: true, pick: picked ?? null })]);
  };
  return html`
    <form class="double-form card" onSubmit=${submit}>
      <h3>Совместное наблюдение</h3>
      <p class="muted">Наблюдатель видит версии одновременно в одной сцене — прямо, в зеркале или живым магическим
        зрением (<a href=${p6("7.3. Обычное зрение, зеркало и магическое зрение")}>П6, 7.3</a>). На каждую непроверенную
        пару — d100, 1–${COLLAPSE_AT} — коллапс. Пары по порядку от ранних версий; после коллапса пары исчезнувшей
        снимаются, выжившая продолжает (<a href=${p6("7.4. Один бросок на пару")}>7.4</a>).</p>
      <div class="row">
        <span class="muted">Видны вместе:</span>
        ${live.map((v) => html`
          <label key=${v.id} title=${v.hidden ? "В закрытом непрозрачном контейнере не видна (П6, 6.6)" : ""}>
            <input type="checkbox" checked=${seen.has(v.id) && !v.hidden} disabled=${v.hidden} onChange=${() => toggle(v.id)} />
            В${v.number}${v.hidden ? " (в контейнере)" : ""}
          </label>`)}
      </div>
      ${pair
        ? html`
          <p>Пара <strong>${versionLabel(o, pair.a)} ↔ ${versionLabel(o, pair.b)}</strong>:
            ${tied(pair)
              ? "порядок равный — при коллапсе выжившую решает 50/50"
              : `при коллапсе остаётся более поздняя В${pair.b.number}`}
            (<a href=${p6("7.9. Какой экземпляр остаётся")}>7.9</a>).</p>
          <div class="row">
            <button type="button" disabled=${busy} onClick=${() => send([rollPair(o, pair, rollDie)])}>бросить d100</button>
            ${left > 1 && html`
              <button type="button" disabled=${busy} onClick=${() => send(rollObservation(o, seen, rollDie))}
                      title="Пары по порядку до последней; при коллапсе пары исчезнувшей версии снимаются без броска">
                бросить до конца (пар до ${left})
              </button>`}
          </div>
          <div class="row">
            <span class="muted">Бросали сами:</span>
            <label>d100 <input type="number" min="1" max="100" class="narrow" value=${roll} onInput=${(e) => setRoll(e.target.value)} /></label>
            ${okRoll && html`<span class=${collapse ? "bad" : "muted"}>${collapse ? "коллапс" : "устойчиво"}</span>`}
            ${needPick && html`
              <label>осталась
                <select value=${pick} onChange=${(e) => setPick(e.target.value)} aria-label="Какая версия осталась по 50/50">
                  <option value="">50/50 за столом</option>
                  ${[pair.a, pair.b].map((v) => html`<option key=${v.id} value=${String(v.id)}>В${v.number}</option>`)}
                </select>
              </label>`}
            <button type="submit" disabled=${busy || !okRoll || (needPick && !picked)}>записать</button>
          </div>`
        : html`<p class="muted">${shown.length >= 2
            ? "Непроверенных пар среди отмеченных нет."
            : live.filter((v) => !v.hidden).length >= 2 ? "Отметьте две версии и больше." : "Видимых вместе версий меньше двух — проверять нечего."}</p>`}
      <div class="row"><button type="button" onClick=${onDone}>закрыть</button></div>
    </form>
  `;
}

// The collapse checks of the object, as P6, 7.4 has the GM note them. The pair
// of a collapse is off the list of pairs, the check stays here (P6, 7.10),
// with its discharge: the P7 card and "В сцену".
function Checks({ canon, object: o, onError }) {
  if (o.checks.length === 0) return null;
  const card = canon.hazards.find((h) => h.id === DISCHARGE);
  return html`
    <h3>Проверки коллапса</h3>
    <ul class="double-checks">
      ${o.checks.map((c) => html`
        <li key=${c.seq}>
          <span class="muted">ход ${c.turn}</span> · <strong>${c.pair}</strong> · d100
          <span class=${`dice${c.result === "collapse" ? " hit" : ""}`}>${c.roll}</span>${c.entered ? html` <span class="muted">(введено)</span>` : ""}
          ${c.result === "stable"
            ? " — устойчиво"
            : html` — <strong class="bad">коллапс</strong>: осталась ${c.survivor.label}${c.tie ? ` (50/50${c.tie.entered ? " за столом" : " сайта"})` : ""},
              ${c.vanished.label} исчезла. Разряд с центром у ${c.survivor.label}${c.at ? ` — ${c.at}` : ""}:
              ${card
                ? html`<a href=${hazardHref(card.id)}>${card.name}</a> <${ToScene} kind="hazard" card=${card} />`
                : html`<span class="bad">карточки разряда в каноне нет</span>`}`}
          <button class="small" title="Проверка была ошибкой; то же, что отмена записи в журнале"
                  onClick=${() => run(undo(c.seq), onError)}>отменить</button>
        </li>`)}
    </ul>
  `;
}

function ObjectCard({ canon, object: o, onError }) {
  const [editing, setEditing] = useState(false);
  // null — no version form; "new" — a new version; otherwise the version edited.
  const [form, setForm] = useState(null);
  // null — no observation; otherwise the ids of the versions seen together.
  const [seen, setSeen] = useState(null);
  const item = o.item && canon.items.find((i) => i.id === o.item);
  const versions = [...liveVersions(o), ...o.versions.filter((v) => v.gone)];
  const remove = () => {
    if (confirm(`Удалить ${objectLabel(o)} «${o.name}» со всеми версиями? Отменить можно из журнала.`)) {
      run(dispatch("double-object-remove", { id: o.id, number: o.number, name: o.name }), onError);
    }
  };
  return html`
    <section class="card double-card">
      ${editing
        ? html`<${ObjectForm} canon=${canon} object=${o} onDone=${() => setEditing(false)} onError=${onError} />`
        : html`
          <div class="row double-head">
            <h2>${objectLabel(o)} · ${o.name}</h2>
            ${item && html`<a href=${itemHref(item.id)}>карточка П12</a>`}
            ${o.item && !item && html`<span class="bad">предмета нет в каноне</span>`}
            <button class="small" onClick=${() => setEditing(true)}>изменить</button>
            <button class="small" onClick=${remove}>удалить</button>
          </div>
          ${o.note && html`<p>${o.note}</p>`}`}
      ${versions.length > 0 && html`
        <div class="scroll">
          <table class="grid double-versions">
            <thead><tr><th>Версия</th><th>Эпоха</th><th>Порядок</th><th>Как попала</th><th>У кого / где</th><th>Отметки</th><th></th></tr></thead>
            <tbody>
              ${versions.map((v) => html`
                <${VersionRow} key=${v.id} object=${o} version=${v} onEdit=${setForm} onError=${onError} />`)}
            </tbody>
          </table>
        </div>`}
      ${form
        ? html`<${VersionForm} key=${form === "new" ? "new" : form.id} object=${o} version=${form === "new" ? null : form}
                               onDone=${() => setForm(null)} onError=${onError} />`
        : html`<div class="row"><button class="small" onClick=${() => setForm("new")}>добавить версию</button></div>`}
      <${Pairs} object=${o} onObserve=${setSeen} />
      ${seen && html`<${ObserveForm} key=${seen.join(",")} object=${o} seen=${seen} onDone=${() => setSeen(null)} onError=${onError} />`}
      <${Checks} canon=${canon} object=${o} onError=${onError} />
    </section>
  `;
}

function Doubles({ canon }) {
  const [error, setError] = useState(null);
  useEffect(() => { setTitle("Временные дубли"); }, []);
  const { objects } = useStore(doublesState);
  const pairs = objects.flatMap(pairsOf);
  const stable = pairs.filter((p) => p.check).length;
  return html`
    <section class="page doubles-page">
      <h1>Временные дубли</h1>
      <p class="muted">
        Дубль — две версии одного индивидуального предмета из разных времён, а не два одинаковых предмета
        (<a href=${p6("6. Временные дубли предметов")}>П6, 6</a>). Для каждого значимого предмета — его версии
        с происхождением (<a href=${p6("6.7. Отслеживание происхождения")}>6.7</a>); пары живых версий сайт
        выводит сам. При первом совместном наблюдении пары — одна проверка коллапса
        (<a href=${p6("7. Процедура коллапса временных дублей")}>П6, 7</a>): «совместно наблюдались» у пары
        или у всего набора версий.
      </p>
      ${error && html`<p class="bad">${error}</p>`}
      <section class="card">
        <h2>Новый объект</h2>
        <${ObjectForm} canon=${canon} object=${null} onDone=${() => {}} onError=${setError} />
        <p class="muted">Объектов: ${objects.length}; пар: ${pairs.length}${stable > 0 ? `, из них устойчивых ${stable}` : ""}.</p>
      </section>
      ${objects.map((o) => html`<${ObjectCard} key=${o.id} canon=${canon} object=${o} onError=${setError} />`)}
      <datalist id="double-eras">${ERAS.map((e) => html`<option key=${e} value=${e} />`)}</datalist>
    </section>
  `;
}

// The registry in short, under the field "Временные дубли" of the P2 sheet
// (the world state and rooms 39 and 41): per object its live versions and
// where they are, the pairs checked and not, the collapses.
export function DoublesSummary() {
  const { objects } = useStore(doublesState);
  const party = useStore(() => partyState().list);
  const cult = cultPairs(objects, party);
  return html`
    <div class="map-edits-note muted">
      <a href=${doublesHref()}>В реестре дублей</a>: ${objects.length ? `объектов ${objects.length}` : "пусто"}
      ${objects.map((o) => {
        const live = liveVersions(o);
        const pairs = pairsOf(o);
        const stable = pairs.filter((p) => p.check).length;
        const collapses = o.checks.filter((c) => c.result === "collapse").length;
        const versions = live.map((v) => `В${v.number}${placeOf(v) ? ` (${placeOf(v)})` : ""}`).join(", ") || "живых версий нет";
        const counts = [
          pairs.length > 0 && `пар ${pairs.length}: устойчивых ${stable}, не проверено ${pairs.length - stable}`,
          collapses > 0 && `коллапсов ${collapses}`,
        ].filter(Boolean).join(" · ");
        return html`<div key=${o.id}>${objectLabel(o)} «${o.name}»: ${versions}${counts ? ` · ${counts}` : ""}</div>`;
      })}
      ${cult.length > 0 && html`<div>Устойчивый дубль у группы — +1 к реакции Культа.</div>`}
    </div>
  `;
}

// The Cult's +1 on the card of No. 10 (P8, 10.4; topic 1.18): once, for any
// number of stable doubles, to the first undetermined reaction roll.
export function CultBonus() {
  const { objects } = useStore(doublesState);
  const party = useStore(() => partyState().list);
  const cult = cultPairs(objects, party);
  const rule = html`<a href=${sectionHref("p8", "10.4. Отношение к путешественники во времени и дублям")}>П8, 10.4</a>`;
  const pairs = cult.map(({ object: o, a, b }) => {
    const carrier = [a, b].map((v) => v.carrier?.name).filter(Boolean)[0];
    return `${versionLabel(o, a)} ↔ В${b.number} «${o.name}»${carrier ? `, у ${carrier}` : ""}`;
  }).join("; ");
  return html`
    <p>
      <strong>Дубли:</strong>
      ${cult.length > 0
        ? html` +1 к первому неопределённому броску реакции, за число дублей не складывается (${rule}): ${pairs}.`
        : html` устойчивого дубля у группы нет — без +1 (${rule}). Считается пара, проверенная с результатом
            «устойчиво», обе версии существуют, одну несёт персонаж группы; непроверенная не считается.`}
      ${" "}<a href=${doublesHref()}>Реестр дублей</a>
    </p>
  `;
}

export function DoublesPage() {
  const { canon, error } = useCanon();
  if (error || !canon) return html`<${CanonState} title="Временные дубли" error=${error} />`;
  return html`<${Doubles} canon=${canon} />`;
}
