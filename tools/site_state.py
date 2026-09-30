"""World state schema of the canon for the Game Master site.

Part of site_build.py: reads the GM's state sheet of P2 ("Минимальный лист
состояния Мастера") and returns it as state of canon.json, the schema of the
"Состояние мира" page. The sheet is a text block of groups: a title in capitals,
then lines "Поле: значение", where the value tells the kind of the field (the
legend above the block):

- variants joined by " / " ("да / нет") are a choice of one;
- a blank of five "_" is a number, "_____ / 17" a number with a limit;
- a blank of ten "_" is a short note, a longer one a list or a log;
- a line that is a blank alone is a free note of the whole group.

A number in the group title, the field label or a variant is a room of the
ship, so the room page can show the fields about it. The table above the block
links each group to its full section in P2, part 3.

The subsection under the sheet, "Исходное состояние Корабля", is a table
"Группа | Поле | На старте | Откуда": the value a field has when the party
arrives, and the canon place that says so. The group cell is written once per
group; "—" in the field cell is the group's free note. A field without a row
starts empty.
"""

import re
from urllib.parse import unquote

SHEET = ("p2", "Минимальный лист состояния Мастера")  # doc and section key of the sheet
START = "Исходное состояние Корабля"  # the subsection with the starting values
FREE_NOTE = "—"
ROOMS = 41  # P2, section 2 "Таблица комнат 1–41"
NUMBER_BLANK = 5
NOTE_BLANK = 10

RE_FIELD = re.compile(r"^([^:]+):\s*(.+)$")
RE_BLANK = re.compile(r"^_+$")
RE_LIMIT = re.compile(r"^_+\s*/\s*(\d+)$")
RE_ROOM = re.compile(r"\b\d+\b")
RE_LINK = re.compile(r"\[[^\]]*\]\(([^)#]*)#([^)]+)\)")


def cells(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def split_sheet(text):
    """(table lines, block lines) of the sheet section: the legend table and the text block."""
    lines = text.split("\n")
    start = next((i for i, line in enumerate(lines) if line.startswith("```")), None)
    if start is None:
        return [], None
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("```")), len(lines))
    table = [line for line in lines[:start] if line.startswith("|")]
    return table[2:], lines[start + 1:end]  # the header and the |---| line are skipped


def kind_of(value):
    """Kind fields of a value, or None if the value is none of the legend's."""
    if RE_BLANK.match(value):
        if len(value) == NUMBER_BLANK:
            return {"kind": "number", "max": None}
        if len(value) >= NOTE_BLANK:
            return {"kind": "text", "long": len(value) > NOTE_BLANK}
        return None
    limit = RE_LIMIT.match(value)
    if limit:
        return {"kind": "number", "max": int(limit.group(1))}
    if "_" in value:
        return None
    options = [o.strip() for o in value.split(" / ")]
    if len(options) < 2 or not all(options):
        return None
    return {"kind": "choice", "options": options}


def rooms_of(*texts):
    return sorted({int(n) for text in texts for n in RE_ROOM.findall(text)})


def find_state(docs, problem):
    """The state sheet of P2 as groups of fields; problems go through `problem`.

    Result: doc, key (the sheet section) and groups in sheet order, each with
    title (as written, in capitals), more ([{doc, key}] from the legend table)
    and fields. A field has key ("ГРУППА · Поле", or the group title for the
    group's free note; the key of the page's events), label (null for a free
    note), kind ("choice" with options, "number" with max or null, "text" with
    long), rooms (numbers in the group title, the label and the variants),
    start (the value when the party arrives: a variant, an int, a string, or
    null) and source (the markdown of "Откуда", or null). The result also has
    start_key, the key of the starting state subsection, or null.
    """
    doc = next((d for d in docs if d["id"] == SHEET[0]), None)
    section = doc and next((s for s in doc["sections"] if s["key"] == SHEET[1]), None)
    if not section:
        problem("error", doc["file"] if doc else SHEET[0], 1, f"нет раздела «{SHEET[1]}» с листом состояния", "")
        return None
    where = (doc["file"], section["line"])
    table, block = split_sheet(section["text"])
    if block is None:
        problem("error", *where, "в листе состояния нет блока текста", section["title"])
        return None

    groups, keys = [], set()
    title_seen = False
    for line in (line.strip() for line in block):
        if not line:
            continue
        if not title_seen:  # "КОРАБЛЬ ВРЕМЕНИ — ГЛОБАЛЬНОЕ СОСТОЯНИЕ"
            title_seen = True
            continue
        field = RE_FIELD.match(line)
        if not field and not RE_BLANK.match(line):
            if line != line.upper():
                problem("warning", *where, "строка листа не похожа ни на группу, ни на поле", line)
                continue
            groups.append({"title": line, "more": [], "fields": []})
            continue
        if not groups:
            problem("warning", *where, "поле листа стоит до первой группы", line)
            continue
        group = groups[-1]
        label, value = (field.group(1).strip(), field.group(2).strip()) if field else (None, line)
        kind = kind_of(value)
        if not kind or (label is None and kind["kind"] != "text"):
            problem("warning", *where, f"в группе «{group['title']}» значение поля не по легенде листа", line)
            continue
        key = f"{group['title']} · {label}" if label else group["title"]
        if key in keys:
            problem("error", *where, f"поле «{key}» в листе дважды", line)
            continue
        keys.add(key)
        rooms = rooms_of(group["title"], label or "", *kind.get("options", []))
        for room in rooms:
            if not 1 <= room <= ROOMS:
                problem("warning", *where, f"в поле «{key}» число {room} — не номер комнаты 1–{ROOMS}", line)
        group["fields"].append({"key": key, "label": label, **kind,
                                "rooms": [r for r in rooms if 1 <= r <= ROOMS], "start": None, "source": None})

    by_title = {g["title"]: g for g in groups}
    by_file = {d["file"]: d for d in docs}
    section_keys = {d["id"]: {s["key"] for s in d["sections"]} for d in docs}
    for row in map(cells, table):
        group = by_title.get(row[0])
        if not group:
            problem("error", *where, f"в таблице групп листа нет группы «{row[0]}» в самом листе", row[0])
            continue
        for file, anchor in RE_LINK.findall(" ".join(row[1:])):
            target = by_file.get(file) if file else doc
            key = unquote(anchor)
            if not target or key not in section_keys[target["id"]]:
                problem("error", *where, f"у группы «{row[0]}» ссылка не нашла раздел «{key}»", row[0])
                continue
            group["more"].append({"doc": target["id"], "key": key})
    for group in groups:
        if not group["more"]:
            problem("warning", *where, f"у группы листа «{group['title']}» нет ссылок в таблице групп", group["title"])
        if not group["fields"]:
            problem("warning", *where, f"в группе листа «{group['title']}» нет полей", group["title"])
    start = next((s for s in doc["sections"] if s["parent"] == section["key"] and s["title"] == START), None)
    if start:
        read_starts(start, {f["key"]: f for g in groups for f in g["fields"]}, (doc["file"], start["line"]), problem)
    else:
        problem("warning", *where, f"под листом нет подраздела «{START}»: поля начнутся пустыми", section["title"])
    return {"doc": doc["id"], "key": section["key"], "start_key": start and start["key"], "groups": groups}


def start_value(field, text):
    """The starting value of a field as the page keeps it, or None if the text does not fit the field."""
    if field["kind"] == "choice":
        return text if text in field["options"] else None
    if field["kind"] == "number":
        n = int(text) if text.isdigit() else None
        return n if n is not None and (field["max"] is None or n <= field["max"]) else None
    return text


def read_starts(section, fields, where, problem):
    """Fill start and source of the fields from the starting state table."""
    rows = [cells(line) for line in section["text"].splitlines() if line.startswith("|")][2:]
    group, seen = None, set()
    for row in rows:
        if len(row) < 4:
            problem("warning", *where, "в таблице исходного состояния строка не из четырёх колонок", " | ".join(row))
            continue
        group = row[0] or group
        label, text, source = row[1], row[2], " | ".join(row[3:])
        key = group if label == FREE_NOTE else f"{group} · {label}"
        field = fields.get(key)
        if not field:
            problem("error", *where, f"исходное состояние для поля «{key}», которого нет в листе", text)
            continue
        if key in seen:
            problem("error", *where, f"исходное состояние поля «{key}» записано дважды", text)
            continue
        seen.add(key)
        value = start_value(field, text)
        if value is None:
            problem("error", *where, f"исходное значение «{text}» не подходит полю «{key}»", text)
            continue
        if not source:
            problem("warning", *where, f"у исходного значения поля «{key}» нет источника", text)
        field["start"], field["source"] = value, source or None
