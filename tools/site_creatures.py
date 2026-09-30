"""Creature stat blocks of the canon for the Game Master site.

Part of site_build.py: finds the stat blocks of P9 and P11 in the parsed
sections and returns them as creatures of canon.json. A block lies in one
section (tails_check.py keeps it so): the section states a level in its
heading ("Сарежейн — Существо 9"), in its first bold line ("**Существо 1**")
or, for the Shell's profile, as "**Числовая калибровка:** 11-й уровень".

Only what the site cannot read from markdown is parsed: the name, the
level, the traits, the numbers the combat scene needs and which subsections
are abilities. Everything else stays markdown and is rendered as written.
"""

import re

from refs_check import NUM

BLOCK_DOCS = ["p9", "p11"]

RE_TITLE_NUMBER = re.compile(rf"^{NUM}\.\s+")
RE_ACTIONS = re.compile(r"\s*`\[([^\]]+)\]`\s*$")
RE_LEVEL_TITLE = re.compile(r"^(.*?)\s+—\s+Существо\s+(-?\d+)$")
RE_LEVEL_LINE = re.compile(r"^\*\*Существо\s+(-?\d+)(?:\s+—\s+(.*?))?\.?\*\*$")
RE_PROFILE_LINE = re.compile(r"^\*\*Числовая калибровка:\*\*\s*(\d+)-й уровень")
RE_AON_LINE = re.compile(r"^\[([^\]]+)\]\((https://2e\.aonprd\.com/Monsters\.aspx\?ID=\d+)\)$")
RE_HEADER_FIELD = re.compile(r"^\*\*(Признаки|Классификация|Роль):\*\*\s*(.*?)\.?\s*$")
MINUS = "[-–−]"
SIGNED = r"([+\-–−]?\d+)"
# Numbers of the combat scene (step 3.15). Reflex and Will share the line of Fortitude.
NUMBERS = {
    "perception": re.compile(rf"^\*\*Восприятие\*\*\s*{SIGNED}"),
    "ac": re.compile(r"^\*\*КБ\*\*\s*(\d+)"),
    "fort": re.compile(rf"^\*\*Стойкость\*\*\s*{SIGNED}"),
    "ref": re.compile(rf"^\*\*Стойкость\*\*.*?\*\*Рефлекс\*\*\s*{SIGNED}"),
    "will": re.compile(rf"^\*\*Стойкость\*\*.*?\*\*Воля\*\*\s*{SIGNED}"),
    "hp": re.compile(r"^\*\*ПЗ\*\*\s*(\d+)"),
}
# A subsection with this title shares its rules with every block of its section
# (P9, 22.1 for the Warehouse prisoners): each of their cards shows it.
SHARED_RULES = "Общие правила"
# The first subsection with one of these titles ends the abilities of a block.
ABILITIES_END = {"Поведение", "Изменения"}

TRANSLIT = dict(zip("абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
                    ["a", "b", "v", "g", "d", "e", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s",
                     "t", "u", "f", "kh", "ts", "ch", "sh", "shch", "", "y", "", "e", "yu", "ya"]))


def slug(name):
    """Latin file name for site/img/<id>.*: "Хрустальный Паук" -> "khrustalnyy-pauk"."""
    latin = "".join(TRANSLIT.get(c, c) for c in name.lower())
    return re.sub(r"[^a-z0-9]+", "-", latin).strip("-")


def plain_title(title):
    """Heading without its number, action marker and trailing parenthesis."""
    title = RE_ACTIONS.sub("", RE_TITLE_NUMBER.sub("", title))
    return re.sub(r"\s*\([^)]*\)$", "", title).strip()


def to_int(text):
    return int(re.sub(MINUS, "-", text))


def block_level(section):
    """(level, name, note, profile) if the section holds a stat block, else None."""
    title = RE_TITLE_NUMBER.sub("", section["title"])
    m = RE_LEVEL_TITLE.match(title)
    if m:
        return int(m.group(2)), plain_title(m.group(1)), None, False
    for line in section["text"].splitlines():
        m = RE_LEVEL_LINE.match(line.strip())
        if m:
            return int(m.group(1)), plain_title(title), m.group(2), False
        m = RE_PROFILE_LINE.match(line)
        if m:
            return int(m.group(1)), plain_title(title).split(" — ")[0], None, True
    return None


def paragraphs(text):
    return [p for p in re.split(r"\n\s*\n", text.strip()) if p.strip()]


def split_block(text):
    """(fields, intro, body, aon) of the block section's own text.

    The level line, the AoN link and the header fields (traits,
    classification, role) are taken out; prose before the first stat line
    is the intro, the rest is the body. A trailing "---" is dropped.
    """
    fields, intro, body, aon = {}, [], [], None
    for para in paragraphs(text):
        lines = []
        for line in para.splitlines():
            bare = line.strip()
            if RE_LEVEL_LINE.match(bare) or bare == "---":
                continue
            m = RE_AON_LINE.match(bare)
            if m:
                aon = {"title": m.group(1), "href": m.group(2)}
                continue
            m = RE_HEADER_FIELD.match(bare)
            if m and m.group(1) not in fields:
                fields[m.group(1)] = m.group(2)
                continue
            lines.append(line)
        if not lines:
            continue
        stat = lines[0].startswith("**")
        (body if stat or body else intro).append("\n".join(lines))
    return fields, "\n\n".join(intro), "\n\n".join(body), aon


def parse_numbers(body):
    numbers, notes = {}, {}
    for line in body.splitlines():
        for name, rx in NUMBERS.items():
            m = rx.search(line)
            if m and name not in numbers:
                numbers[name] = to_int(m.group(1))
                rest = line[m.end():].strip(" \t")
                if name == "ac" and rest.startswith("("):
                    notes["ac"] = rest.strip("() ")
    return numbers, notes


def find_creatures(docs, problem):
    """Creatures of P9 and P11 in canon order; problems go through `problem`.

    Each creature: id (slug of the name, the image file name), doc, key (the
    block section), home (the section about the creature as a whole: the
    parent in P11, where the block is one subsection of the NPC), name,
    level, note (after the level, "рой"), budget (false for a profile that
    is not a creature for the encounter budget), traits, classification,
    role, aon, intro and body (markdown), numbers (perception, ac, fort,
    ref, will, hp) with notes, abilities and info (subsections as
    {key, title, actions}; first the "Общие правила" of the section above
    the creature, if it has them).
    """
    creatures, ids = [], {}
    for doc in (d for d in docs if d["id"] in BLOCK_DOCS):
        sections = doc["sections"]
        by_key = {s["key"]: s for s in sections}
        children = {}
        for s in sections:
            children.setdefault(s["parent"], []).append(s)
        for section in sections:
            found = block_level(section)
            if not found:
                continue
            level, name, note, profile = found
            parent = by_key.get(section["parent"])
            home = parent if parent and plain_title(parent["title"]) == name else section
            fields, intro, body, aon = split_block(section["text"])
            if not intro and home is not section:
                intro = "\n\n".join(p for p in paragraphs(home["text"]) if p.strip() != "---")
            numbers, notes = parse_numbers(body)
            where = (doc["file"], section["line"])
            missing = [n for n in NUMBERS if n not in numbers]
            if missing:
                problem("warning", *where, f"в блоке «{name}» не разобраны числа: {', '.join(missing)}",
                        section["title"])
            if not profile and "Признаки" not in fields:
                problem("warning", *where, f"в блоке «{name}» нет строки признаков", section["title"])

            abilities, info, in_abilities = [], [], True
            for child in children.get(section["key"], []):
                title = RE_ACTIONS.sub("", child["title"])
                in_abilities = in_abilities and title not in ABILITIES_END
                actions = RE_ACTIONS.search(child["title"])
                (abilities if in_abilities else info).append(
                    {"key": child["key"], "title": title, "actions": actions.group(1) if actions else None})
            if home is not section:
                info += [{"key": s["key"], "title": s["title"], "actions": None}
                         for s in children.get(home["key"], []) if s is not section]
            group = by_key.get(home["parent"])
            rules = group and next((s for s in children.get(group["key"], [])
                                    if plain_title(s["title"]) == SHARED_RULES), None)
            if rules:
                info.insert(0, {"key": rules["key"], "actions": None,
                                "title": f"{SHARED_RULES}: {RE_TITLE_NUMBER.sub('', group['title'])}"})

            creature_id = slug(name)
            if creature_id in ids:
                problem("error", *where, f"id существа «{creature_id}» уже занят блоком «{ids[creature_id]}»",
                        section["title"])
            ids[creature_id] = name
            traits = [t.strip() for t in fields.get("Признаки", "").split(",") if t.strip()]
            creatures.append({
                "id": creature_id, "doc": doc["id"], "key": section["key"], "home": home["key"], "name": name,
                "level": level, "note": note, "budget": not profile, "traits": traits,
                "classification": fields.get("Классификация"), "role": fields.get("Роль"), "aon": aon,
                "intro": intro, "body": body, "numbers": numbers, "notes": notes,
                "abilities": abilities, "info": info,
            })
    return creatures
