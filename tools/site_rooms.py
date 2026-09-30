"""Rooms of the ship for the Game Master site.

Part of site_build.py: reads the 41 rooms of P13 ("### 4. Коридор" under
"## Комнаты 1–41") and returns them as rooms of canon.json. What a room is
tied to is written in the canon, not guessed by name:

- cards: the links of the room's "**Связанные системы:**" line (step 3.12b).
  A link to a section gives every card whose own section is that section or
  lies under it (P9, 22 gives the eleven Warehouse prisoners; P12, 19 the six
  Museum exhibits), a creature also by its NPC section in P11, and an NPC by
  its card in P8, 20 or a section of its "Подробно". A link to a whole file
  gives no card. Links to other rooms are the room's neighbours.
- state: the P2 sheet fields the room's text names as `ГРУППА · Поле`
  (step 3.12c), and the fields whose name holds the room's number. A name
  that is not a sheet field, and a value after "=" that the field does not
  take, are builder errors.
"""

import re
from urllib.parse import unquote

ROOMS_DOC = "p13"
ROOMS_TOP = "Комнаты 1–41"
RELATED = "**Связанные системы:**"
START = "**Старт группы:**"  # the room where the party begins (topic 1.15 of the register)
ENCOUNTERS = "**Случайные встречи"  # a line "**Случайные встречи:** …" or a heading "**Случайные встречи**"
RE_NOT_CHECKED = re.compile(r"не (?:проверяется|генерируется)")
RE_ROOM_TITLE = re.compile(r"^(\d+)\.\s+(.+)$")
RE_LINK = re.compile(r"\[[^\]]*\]\(([^)#]*)(?:#([^)]+))?\)")
RE_CODE = re.compile(r"`([^`\n]+)`")


def subtree_keys(doc, key):
    """Keys of a section and everything under it, in order."""
    sections = doc["sections"]
    start = next((i for i, s in enumerate(sections) if s["key"] == key), None)
    if start is None:
        return []
    level, keys = sections[start]["level"], [key]
    for s in sections[start + 1:]:
        if s["level"] <= level:
            break
        keys.append(s["key"])
    return keys


def field_refs(text, fields, groups):
    """(key, values, match) for every `ГРУППА · Поле` in backticks, values after "=" or [].

    Several fields may share one span, as in a trigger
    `ГРУППА · Поле = а + ГРУППА · Поле = б → ГРУППА · Поле = в; …`.
    """
    refs = []
    by_group = {}
    for key in sorted(fields, key=len, reverse=True):
        if " · " in key:
            by_group.setdefault(key.split(" · ")[0], []).append(key)
    for code in RE_CODE.finditer(text):
        span = code.group(1)
        for group in groups:
            for m in re.finditer(re.escape(group) + " · ", span):
                rest = span[m.start():]
                key = next((k for k in by_group.get(group, []) if rest.startswith(k)), None)
                if key is None:
                    refs.append((None, [], rest.split(" = ")[0].split(";")[0].strip()))
                    continue
                # A value ends where the trigger goes on: "; next", "+ next", ", либо next", "→ result".
                after = re.match(r"\s*=\s*([^;,+→`]+)", rest[len(key):])
                values = [v.strip().rstrip(".") for v in after.group(1).split(" / ")] if after else []
                refs.append((key, values, key))
    return refs


def encounters_note(texts):
    """The text of a room's "Случайные встречи" block, or None: the rest of its line, else the next paragraph."""
    for s in texts:
        lines = s["text"].splitlines()
        for i, line in enumerate(lines):
            if not line.startswith(ENCOUNTERS):
                continue
            rest = re.sub(r"^\*\*Случайные встречи:?\*\*:?", "", line).strip()
            if rest:
                return rest
            return next((l.strip() for l in lines[i + 1:] if l.strip()), "")
    return None


def card_owners(creatures, hazards, npcs, items):
    """(kind, id, doc, key) for every section that gives a card when a link names it or a section above it."""
    owners = []
    for kind, cards in (("creatures", creatures), ("hazards", hazards), ("items", items)):
        for c in cards:
            owners.append((kind, c["id"], c["doc"], c["key"]))
            if kind == "creatures" and c["home"] != c["key"]:
                owners.append((kind, c["id"], c["doc"], c["home"]))
    for n in npcs:
        owners.append(("npcs", n["id"], n["doc"], n["key"]))
        owners += [("npcs", n["id"], m["doc"], m["key"]) for m in n["more"]]
    return owners


def linked_cards(target, key, owners):
    """(kind, id) of the cards a link to section `key` of doc `target` gives, in owner order."""
    under = set(subtree_keys(target, key))
    return [(kind, card_id) for kind, card_id, card_doc, card_key in owners
            if card_doc == target["id"] and card_key in under]


def value_ok(field, value):
    """Whether a sheet field takes a value written after "=" in the canon."""
    if field["kind"] == "choice":
        return value in field["options"]
    if field["kind"] == "number":
        return value.isdigit() and (field["max"] is None or int(value) <= field["max"])
    return True


def find_rooms(docs, creatures, hazards, npcs, items, state, problem):
    """Rooms of P13 in canon order; problems go through `problem`.

    Each room: number, id ("komnata-N", the picture name), doc, key (the room
    section), title (without the number), creatures, hazards, items, npcs
    (card ids in the order the related line names them), neighbours (room
    numbers linked from that line), fields (sheet field keys: named in the
    room's text first, then those whose name holds the room's number), start
    (the room has the line START: the party begins there; exactly one room
    must have it) and outside (its "Случайные встречи" block says the P10
    table is not checked there: the room is outside the ship's inner space).
    A block that says something else is a builder warning.
    """
    by_id = {d["id"]: d for d in docs}
    by_file = {d["file"]: d for d in docs}
    doc = by_id.get(ROOMS_DOC)
    top = doc and next((s for s in doc["sections"] if s["title"] == ROOMS_TOP), None)
    if not top:
        problem("error", doc["file"] if doc else ROOMS_DOC, 1, f"нет раздела «{ROOMS_TOP}» с комнатами", "")
        return []

    fields = {f["key"]: f for g in (state["groups"] if state else []) for f in g["fields"]}
    groups = [g["title"] for g in (state["groups"] if state else [])]
    room_keys = {}
    for s in doc["sections"]:
        m = RE_ROOM_TITLE.match(s["title"])
        if s["parent"] == top["key"] and m:
            room_keys[s["key"]] = int(m.group(1))

    owners = card_owners(creatures, hazards, npcs, items)

    rooms = []
    for section in doc["sections"]:
        number = room_keys.get(section["key"])
        if number is None:
            continue
        where = (doc["file"], section["line"])
        title = RE_ROOM_TITLE.match(section["title"]).group(2).strip()
        keys = subtree_keys(doc, section["key"])
        texts = [s for s in doc["sections"] if s["key"] in keys]
        room = {"number": number, "id": f"komnata-{number}", "doc": doc["id"], "key": section["key"], "title": title,
                "creatures": [], "hazards": [], "items": [], "npcs": [], "neighbours": [], "fields": [],
                "start": any(line.startswith(START) for s in texts for line in s["text"].splitlines()),
                "outside": False}
        note = encounters_note(texts)
        if note is not None:
            room["outside"] = bool(RE_NOT_CHECKED.search(note))
            if not room["outside"]:
                problem("warning", *where, f"в комнате {number} блок «Случайные встречи» не говорит, "
                        "что таблица П10 здесь не проверяется", section["title"])

        related = next((line for s in texts for line in s["text"].splitlines() if line.startswith(RELATED)), None)
        if related is None:
            problem("warning", *where, f"у комнаты {number} нет строки «Связанные системы»", section["title"])
        for file, anchor in RE_LINK.findall(related or ""):
            if not anchor or file.startswith("http"):
                continue
            target = by_file.get(file) if file else doc
            key = unquote(anchor)
            if not target or not any(s["key"] == key for s in target["sections"]):
                problem("error", *where, f"в связях комнаты {number} ссылка не нашла раздел «{key}»", section["title"])
                continue
            if target is doc and key in room_keys:
                if room_keys[key] != number and room_keys[key] not in room["neighbours"]:
                    room["neighbours"].append(room_keys[key])
                continue
            for kind, card_id in linked_cards(target, key, owners):
                if card_id not in room[kind]:
                    room[kind].append(card_id)

        for s in texts:
            for key, values, name in field_refs(s["text"], fields, groups):
                if key is None:
                    problem("error", doc["file"], s["line"], f"в комнате {number} поле «{name}» не найдено в листе П2",
                            s["title"])
                    continue
                field = fields[key]
                for v in values:
                    if not value_ok(field, v):
                        problem("error", doc["file"], s["line"],
                                f"в комнате {number} у поля «{key}» нет значения «{v}»", s["title"])
                if key not in room["fields"]:
                    room["fields"].append(key)
        for key, field in fields.items():
            if number in (field.get("rooms") or []) and key not in room["fields"]:
                room["fields"].append(key)
        rooms.append(room)

    starts = [r["number"] for r in rooms if r["start"]]
    if rooms and len(starts) != 1:
        problem("error", doc["file"], top["line"],
                f"строка «{START}» должна быть ровно у одной комнаты, а она у {starts or 'ни одной'}", top["title"])
    numbers = sorted(r["number"] for r in rooms)
    if numbers != list(range(1, len(numbers) + 1)):
        problem("warning", doc["file"], top["line"], f"номера комнат идут не подряд: {numbers}", top["title"])
    return rooms
