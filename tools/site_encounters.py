"""Random encounters of the ship for the Game Master site.

Part of site_build.py: reads the random encounter table of P10 and returns it
as the encounters of canon.json. What a row is tied to is written in the
canon, not guessed by name:

- the table: the rows of section 4.2 ("Единая накопительная таблица 1–12"),
  one per result, and the dice by party level from the table of section 3
  ("Принцип накопительной таблицы": level, "1dN", rows "1–N");
- the card: the section "№ N. Название" under section 12 with everything
  under it;
- the cards of a row: the links of the card's "**Связанные системы:**" line
  (step 3.14a), resolved as a room's links are (site_rooms.py). The line is
  split at ";" into parts; the text of a part outside its links is its role:
  "состав" makes its creatures the row's composition, «…» after "вариант"
  names a scene variant of the card. A part with links only keeps the role
  of the part before it ("трофеи — [18.1]; [18.2]").
- the variants: the card's paragraphs "**Вариант сцены — название.** …";
- the state: the P2 sheet fields the card names as `ГРУППА · Поле`.

A missing section, a table row that does not read, a card missing for a row,
a link without a target, a sheet field the sheet lacks and a variant role
naming no variant of the card are builder errors.
"""

import re
from urllib.parse import unquote

from site_rooms import RE_LINK, card_owners, field_refs, linked_cards, subtree_keys, value_ok

ENCOUNTERS_DOC = "p10"
LEVELS_TITLE = "Принцип накопительной таблицы"
TABLE_TITLE = "Единая накопительная таблица 1–12"
CARDS_TITLE = "Полные карточки всех результатов"
OUTSIDE_TITLE = "Сцены вне таблицы"
PROCEDURE_TITLE = "Что сохраняется из исходника"
STOP_TITLE = "Корабль отделился от текущей реальности"
RELATED = "**Связанные системы:**"
TABLE_COLUMNS = 10
RE_NUMBER = re.compile(r"^[\d.]+\s+")
RE_CARD = re.compile(r"^№ (\d+)\.\s+(.+)$")
RE_DIE = re.compile(r"^1d(\d+)$")
RE_RANGE = re.compile(r"^(\d+)\s*[–-]\s*(\d+)$")
RE_COUNT = re.compile(r"^(\d+d\d+|\d+)(?=$|[\s;,])")
RE_VARIANT = re.compile(r"^\*\*Вариант сцены — (.+?)\.\*\*\s*(.*)$")
RE_VARIANT_ROLE = re.compile(r"вариант\w*\s+((?:«[^»]+»(?:\s*(?:,|и)\s*)?)+)")
RE_QUOTED = re.compile(r"«([^»]+)»")
RE_LINKS = re.compile(r"\[[^\]]*\]\([^)]*\)")


def table_rows(text):
    """Cells of the body rows of the first markdown table in a section text."""
    rows, started = [], False
    for line in text.splitlines():
        if line.startswith("|"):
            started = True
            if not re.match(r"^\|[\s:|-]+$", line):
                rows.append([c.strip() for c in line.strip().strip("|").split("|")])
        elif started:
            break
    return rows[1:]


def plain(title):
    return RE_NUMBER.sub("", title)


def related_parts(line):
    """(role, [(file, anchor)]) for each ";" part of a related-systems line."""
    parts, role = [], ""
    for part in line[len(RELATED):].split(";"):
        links = RE_LINK.findall(part)
        text = RE_LINKS.sub("", part).strip(" .,—")
        if text:
            role = text
        parts.append((role, links))
    return parts


def find_encounters(docs, creatures, hazards, npcs, items, state, rooms, problem):
    """The random encounter table of P10, or None; problems go through `problem`.

    Returns doc, key (the table section), cards (the cards section), outside
    (the scenes outside the table), procedure (section 2, the checks), stop
    (section 18, the detached ship ends the checks), levels ([{level, die}] by party level)
    and rows, each: number, level (available from), name, key (card section),
    count (the dice of the composition, "1d6" or "2", or None), composition
    (the column as written), type, chrono, repeat, reaction, signs, motive
    (the other columns), creatures, hazards, items, npcs (card ids of the
    related line, in order), main (creature ids of the composition), rooms
    (room numbers linked), fields (sheet field keys the card names) and
    variants ([{name, text, creatures}]).
    """
    by_id = {d["id"]: d for d in docs}
    by_file = {d["file"]: d for d in docs}
    doc = by_id.get(ENCOUNTERS_DOC)
    if doc is None:
        problem("error", ENCOUNTERS_DOC, 1, "нет пункта случайных встреч", "")
        return None
    sections = {}
    for title in (LEVELS_TITLE, TABLE_TITLE, CARDS_TITLE, OUTSIDE_TITLE, PROCEDURE_TITLE, STOP_TITLE):
        sections[title] = next((s for s in doc["sections"] if plain(s["title"]) == title), None)
        if sections[title] is None:
            problem("error", doc["file"], 1, f"нет раздела «{title}»", "")
    if None in sections.values():
        return None

    levels = []
    level_section = sections[LEVELS_TITLE]
    for offset, row in enumerate(table_rows(level_section["text"]), 1):
        die = RE_DIE.match(row[1]) if len(row) >= 3 else None
        span = RE_RANGE.match(row[2]) if die else None
        if not (row[0].isdigit() and die and span and span.group(1) == "1" and span.group(2) == die.group(1)):
            problem("error", doc["file"], level_section["line"], "строка таблицы уровней не по образцу "
                    "«уровень | 1dN | 1–N»", " | ".join(row))
            continue
        levels.append({"level": int(row[0]), "die": int(die.group(1))})

    fields = {f["key"]: f for g in (state["groups"] if state else []) for f in g["fields"]}
    groups = [g["title"] for g in (state["groups"] if state else [])]
    owners = card_owners(creatures, hazards, npcs, items)
    room_of = {(r["doc"], r["key"]): r["number"] for r in rooms}
    cards_section = sections[CARDS_TITLE]
    cards = {}
    for s in doc["sections"]:
        m = RE_CARD.match(s["title"])
        if s["parent"] == cards_section["key"] and m:
            cards[int(m.group(1))] = (s, m.group(2).strip())

    table = sections[TABLE_TITLE]
    rows = []
    for row in table_rows(table["text"]):
        where = (doc["file"], table["line"])
        if len(row) != TABLE_COLUMNS or not row[0].isdigit() or not row[1].isdigit():
            problem("error", *where, f"строка таблицы встреч не из {TABLE_COLUMNS} столбцов с номером и уровнем",
                    " | ".join(row))
            continue
        number, level = int(row[0]), int(row[1])
        if level not in [x["level"] for x in levels]:
            problem("error", *where, f"строка {number} доступна с уровня {level}, которого нет в таблице уровней",
                    " | ".join(row))
        count = RE_COUNT.match(row[3])
        entry = {"number": number, "level": level, "name": row[2], "key": None,
                 "count": count.group(1) if count else None, "composition": row[3], "type": row[4],
                 "chrono": row[5], "repeat": row[6], "reaction": row[7], "signs": row[8], "motive": row[9],
                 "creatures": [], "hazards": [], "items": [], "npcs": [], "main": [], "rooms": [],
                 "fields": [], "variants": []}
        rows.append(entry)
        if number not in cards:
            problem("error", *where, f"у строки {number} нет карточки «№ {number}.» в разделе 12", row[2])
            continue
        section, name = cards[number]
        entry["key"] = section["key"]
        where = (doc["file"], section["line"])
        if name != row[2]:
            problem("warning", *where, f"карточка № {number} называется иначе, чем строка таблицы: «{row[2]}»", name)
        texts = [s for s in doc["sections"] if s["key"] in subtree_keys(doc, section["key"])]
        lines = [line for s in texts for line in s["text"].splitlines()]

        for line in lines:
            m = RE_VARIANT.match(line)
            if m:
                entry["variants"].append({"name": m.group(1), "text": m.group(2), "creatures": []})
        variants = {v["name"]: v for v in entry["variants"]}

        related = next((line for line in lines if line.startswith(RELATED)), None)
        if related is None:
            problem("error", *where, f"у карточки № {number} нет строки «Связанные системы»", section["title"])
        for role, links in related_parts(related or ""):
            named = [n for group in RE_VARIANT_ROLE.findall(role) for n in RE_QUOTED.findall(group)]
            for n in named:
                if n not in variants:
                    problem("error", *where, f"в связях карточки № {number} нет варианта сцены «{n}»", role)
            for file, anchor in links:
                if not anchor or file.startswith("http"):
                    continue
                target = by_file.get(file) if file else doc
                key = unquote(anchor)
                if not target or not any(s["key"] == key for s in target["sections"]):
                    problem("error", *where, f"в связях карточки № {number} ссылка не нашла раздел «{key}»",
                            section["title"])
                    continue
                if (target["id"], key) in room_of:
                    if room_of[(target["id"], key)] not in entry["rooms"]:
                        entry["rooms"].append(room_of[(target["id"], key)])
                    continue
                for kind, card_id in linked_cards(target, key, owners):
                    if card_id not in entry[kind]:
                        entry[kind].append(card_id)
                    if kind != "creatures":
                        continue
                    if "состав" in role and card_id not in entry["main"]:
                        entry["main"].append(card_id)
                    for n in named:
                        if n in variants and card_id not in variants[n]["creatures"]:
                            variants[n]["creatures"].append(card_id)
        for v in entry["variants"]:
            if not v["creatures"]:
                problem("warning", *where, f"строка связей карточки № {number} не называет существ варианта "
                        f"«{v['name']}»", v["name"])

        for s in texts:
            for key, values, name in field_refs(s["text"], fields, groups):
                if key is None:
                    problem("error", doc["file"], s["line"],
                            f"в карточке № {number} поле «{name}» не найдено в листе П2", s["title"])
                    continue
                for v in values:
                    if not value_ok(fields[key], v):
                        problem("error", doc["file"], s["line"],
                                f"в карточке № {number} у поля «{key}» нет значения «{v}»", s["title"])
                if key not in entry["fields"]:
                    entry["fields"].append(key)

    numbers = [r["number"] for r in rows]
    if numbers != list(range(1, len(rows) + 1)):
        problem("error", doc["file"], table["line"], f"номера строк встреч идут не подряд: {numbers}", table["title"])
    if levels and max(x["die"] for x in levels) != len(rows):
        problem("error", doc["file"], level_section["line"],
                f"самый большой кубик — d{max(x['die'] for x in levels)}, а строк в таблице {len(rows)}",
                level_section["title"])
    for x in levels:
        if [r["number"] for r in rows if r["level"] <= x["level"]] != list(range(1, x["die"] + 1)):
            problem("error", doc["file"], table["line"],
                    f"на уровне {x['level']} кубик d{x['die']}, а доступны другие строки", table["title"])
    for number in sorted(set(cards) - set(numbers)):
        problem("error", doc["file"], cards[number][0]["line"], f"карточка № {number} без строки в таблице",
                cards[number][0]["title"])

    return {"doc": doc["id"], "key": table["key"], "cards": cards_section["key"],
            "outside": sections[OUTSIDE_TITLE]["key"], "procedure": sections[PROCEDURE_TITLE]["key"],
            "stop": sections[STOP_TITLE]["key"], "levels": levels, "rows": rows}
