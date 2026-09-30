"""Event log of the Game Master site.

The party state is never stored directly: every action on the site is an
event, and the browser rebuilds the state by applying events in order. The
server only numbers events, keeps them on disk and hands them to every open
window.

A save is saves/current.jsonl in JSON Lines: a header line, then one event per
line. Each event is written and flushed to disk before it is announced, so a
crash loses at most the action being made. Starting a new game or importing a
save first moves the current one to saves/archive/, so nothing is lost.
"""

import datetime
import json
import os
import queue
import threading
import uuid

FORMAT = "korabl-save/1"


class SaveError(ValueError):
    """A save file or an event the log cannot accept."""


def _now():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def _header():
    return {"format": FORMAT, "save": uuid.uuid4().hex[:12], "created": _now()}


def parse_save(text):
    """Header and events of a save file; raises SaveError if it is broken.

    A torn last line (the server stopped mid-write) is dropped and reported
    instead of failing the whole save.
    """
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        raise SaveError("файл пуст")
    try:
        header = json.loads(lines[0])
    except json.JSONDecodeError:
        raise SaveError("первая строка — не заголовок сохранения")
    if not isinstance(header, dict) or header.get("format") != FORMAT:
        raise SaveError(f"это не сохранение формата {FORMAT}")

    events, torn = [], None
    for number, line in enumerate(lines[1:], start=2):
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            if number == len(lines):
                torn = number
                break
            raise SaveError(f"строка {number}: не JSON")
        if not (isinstance(event, dict) and isinstance(event.get("seq"), int)
                and isinstance(event.get("type"), str) and event["type"]):
            raise SaveError(f"строка {number}: не событие")
        if events and event["seq"] <= events[-1]["seq"]:
            raise SaveError(f"строка {number}: номер события не растёт")
        events.append(event)
    return header, events, torn


class EventLog:
    def __init__(self, directory):
        self.directory = directory
        self.path = os.path.join(directory, "current.jsonl")
        self.lock = threading.Lock()
        self.clients = set()
        self.warning = None
        self._load()

    # --- disk ---

    def _load(self):
        os.makedirs(self.directory, exist_ok=True)
        if not os.path.exists(self.path):
            self._start({"header": _header(), "events": []})
            return
        with open(self.path, encoding="utf-8") as file:
            header, events, torn = parse_save(file.read())
        self.header, self.events = header, events
        if torn:
            self.warning = f"строка {torn} сохранения оборвана и пропущена"
            self._rewrite()

    def _rewrite(self):
        temp = self.path + ".tmp"
        with open(temp, "w", encoding="utf-8", newline="\n") as file:
            file.write(json.dumps(self.header, ensure_ascii=False) + "\n")
            for event in self.events:
                file.write(json.dumps(event, ensure_ascii=False) + "\n")
            file.flush()
            os.fsync(file.fileno())
        os.replace(temp, self.path)

    def _archive(self):
        if not self.events:
            return
        archive = os.path.join(self.directory, "archive")
        os.makedirs(archive, exist_ok=True)
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        os.replace(self.path, os.path.join(archive, f"{stamp}-{self.header['save']}.jsonl"))

    def _start(self, save):
        self.header, self.events = save["header"], save["events"]
        self._rewrite()

    # --- events ---

    def append(self, type_, data):
        if not isinstance(type_, str) or not type_:
            raise SaveError("у события нет типа")
        with self.lock:
            if type_ == "undo":
                target = data.get("target") if isinstance(data, dict) else None
                if not any(e["seq"] == target for e in self.events):
                    raise SaveError("отменять нечего: нет такого события")
            seq = self.events[-1]["seq"] + 1 if self.events else 1
            event = {"seq": seq, "ts": _now(), "type": type_, "data": data}
            with open(self.path, "a", encoding="utf-8", newline="\n") as file:
                file.write(json.dumps(event, ensure_ascii=False) + "\n")
                file.flush()
                os.fsync(file.fileno())
            self.events.append(event)
            self._broadcast("append", event)
        return event

    def new_game(self):
        with self.lock:
            self._archive()
            self._start({"header": _header(), "events": []})
            self._broadcast("reset", self.info())

    def import_save(self, text):
        header, events, _ = parse_save(text)
        with self.lock:
            self._archive()
            # A fresh id tells every window that this is another save; the
            # game keeps the date it was started.
            fresh = _header()
            fresh["created"] = header.get("created", fresh["created"])
            self._start({"header": fresh, "events": events})
            self._broadcast("reset", self.info())

    def export_text(self):
        with self.lock, open(self.path, encoding="utf-8") as file:
            return file.read()

    def info(self):
        return {"save": self.header["save"], "created": self.header["created"],
                "count": len(self.events), "warning": self.warning}

    # --- windows ---

    def subscribe(self, save, since):
        """Queue for one window and the events it has not seen yet.

        A window that knows another save gets the whole log and is told to
        drop what it had.
        """
        client = queue.Queue()
        with self.lock:
            fresh = save != self.header["save"]
            backlog = [e for e in self.events if fresh or e["seq"] > since]
            self.clients.add(client)
            return client, {**self.info(), "fresh": fresh}, backlog

    def unsubscribe(self, client):
        with self.lock:
            self.clients.discard(client)

    def _broadcast(self, kind, payload):
        for client in self.clients:
            client.put((kind, payload, self.header["save"]))
