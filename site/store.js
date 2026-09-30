import { useEffect, useState } from "./vendor/htm-preact.js";

// Party state as an event log (see tools/site_events.py).
//
// The server numbers events and streams them to every window; this module
// keeps the log and rebuilds the state from it. The state is never edited in
// place: a page calls dispatch(), the event comes back through the stream and
// every window applies it in the same order.
//
// Each feature describes its part of the state as a slice:
//   defineSlice("notes", () => [], { note: (notes, data, event) => ... });
// Handlers mutate the fresh slice they are given; the state is rebuilt from
// scratch on every change, so no handler sees a stale object.

const slices = {};
const listeners = new Set();

let log = [];         // all events of the current save, in order
let save = null;      // { save, created, count, warning }
let connected = false;
let version = 0;
let cache = null;     // derived data for the current version
let source = null;

export function defineSlice(key, initial, handlers) {
  slices[key] = { initial, handlers };
  changed();
}

// --- undo ---

// An undo event cancels its target; an undo of an undo brings the target
// back. Walking the log backwards, an event is cancelled when a live undo
// points at it.
function cancelledSet(events) {
  const cancelled = new Set();
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!cancelled.has(event.seq) && event.type === "undo") cancelled.add(event.data.target);
  }
  return cancelled;
}

// Undo and redo stacks, as a person expects them: a new action clears redo.
function stacks(events, cancelled) {
  const bySeq = new Map(events.map((e) => [e.seq, e]));
  let done = [];
  let undone = [];
  for (const event of events) {
    if (event.type !== "undo") {
      done.push(event.seq);
      undone = [];
    } else if (bySeq.get(event.data.target)?.type === "undo") {
      // Redo: the undo it cancels leaves the redo stack.
      const undo = bySeq.get(event.data.target);
      undone = undone.filter((seq) => seq !== undo.seq);
      if (!cancelled.has(undo.data.target)) done.push(undo.data.target);
    } else {
      done = done.filter((seq) => seq !== event.data.target);
      undone.push(event.seq);
    }
  }
  return { undoTarget: done.at(-1) ?? null, redoTarget: undone.at(-1) ?? null };
}

function derive() {
  if (cache?.version === version) return cache;
  const cancelled = cancelledSet(log);
  const state = {};
  for (const [key, slice] of Object.entries(slices)) state[key] = slice.initial();
  for (const event of log) {
    if (event.type === "undo" || cancelled.has(event.seq)) continue;
    for (const [key, slice] of Object.entries(slices)) {
      const handler = slice.handlers[event.type];
      if (handler) {
        const result = handler(state[key], event.data, event);
        if (result !== undefined) state[key] = result;
      }
    }
  }
  cache = { version, state, cancelled, ...stacks(log, cancelled) };
  return cache;
}

function changed() {
  version++;
  for (const listener of listeners) listener(version);
}

// --- reading ---

export function getState() {
  return derive().state;
}

// Journal view: every event with a flag telling whether it is in force.
export function getLog() {
  const { cancelled } = derive();
  return log.map((event) => ({ ...event, cancelled: cancelled.has(event.seq) }));
}

export function getStatus() {
  const { undoTarget, redoTarget } = derive();
  return { connected, save, count: log.length, canUndo: undoTarget !== null, canRedo: redoTarget !== null };
}

// Re-renders the component on every change; select() picks what it needs.
export function useStore(select) {
  const [, setVersion] = useState(version);
  useEffect(() => {
    listeners.add(setVersion);
    // Effects run after paint; changes that came in between are caught here.
    setVersion(version);
    return () => listeners.delete(setVersion);
  }, []);
  return select();
}

// --- writing ---

async function post(path, body, contentType = "application/json") {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `ошибка ${response.status}`);
  return payload;
}

export function dispatch(type, data = {}) {
  return post("/api/events", JSON.stringify({ type, data }));
}

export function undo(seq) {
  return dispatch("undo", { target: seq });
}

export function undoLast() {
  const { undoTarget } = derive();
  return undoTarget === null ? null : undo(undoTarget);
}

export function redoLast() {
  const { redoTarget } = derive();
  return redoTarget === null ? null : undo(redoTarget);
}

export function newGame() {
  return post("/api/save/new", "");
}

export function importSave(text) {
  return post("/api/save/import", text, "application/x-ndjson");
}

// --- stream ---

// Event ids are "save:seq". EventSource sends the last one back when it
// reconnects, so the server resumes where this window stopped, or sends the
// whole log if the save was replaced meanwhile.
function connect() {
  source?.close();
  source = new EventSource("/api/stream");

  source.addEventListener("hello", (message) => {
    const hello = JSON.parse(message.data);
    if (hello.fresh) log = [];
    save = hello;
    connected = true;
    changed();
  });

  source.addEventListener("append", (message) => {
    const event = JSON.parse(message.data);
    if (event.seq <= (log.at(-1)?.seq ?? 0)) return; // replay after reconnect
    log.push(event);
    save = { ...save, count: log.length };
    changed();
  });

  // Another save was loaded: start over with a clean stream.
  source.addEventListener("reset", () => {
    log = [];
    changed();
    connect();
  });

  source.onerror = () => {
    // EventSource reconnects by itself; the flag only shows the state.
    if (connected) {
      connected = false;
      changed();
    }
  };
}

connect();
