"""Hazard stat blocks of the canon for the Game Master site.

Part of site_build.py: finds the hazard blocks of P7 in the parsed sections
and returns them as hazards of canon.json. A block is one section whose
heading states the level: "Взрыв часов 41 — Опасность 8" or, for a complex
hazard, "… — Опасность 8 (комплексная)". Its reactions and actions are
subsections; the last one, "Обоснование", explains the numbers.

As with creatures, only what the site cannot read from markdown is parsed:
the name, the level, the traits, the Stealth, the saves and the numbers the
combat scene needs. Everything else stays markdown and is rendered as written.

A block may end its own text with "**Подробно** …": links to the sections of
P7 that tell where and how the hazard comes into play (6.1 for the energy
doors, 8.2 for the clock). The card folds them, as the NPC card does.
"""

import re

from site_creatures import RE_TITLE_NUMBER, paragraphs, slug, to_int
from site_npcs import more_links

BLOCK_DOCS = ["p7"]

# P7 writes the action marker without backticks: "Индукционный импульс [реакция]".
RE_ACTIONS = re.compile(r"\s*`?\[([^\]]+)\]`?\s*$")
RE_LEVEL_TITLE = re.compile(r"^(.*?)\s+—\s+Опасность\s+(\d+)(\s+\(комплексная\))?$")
RE_TRAITS = re.compile(r"^\*\*Признаки:\*\*\s*(.*?)\.?\s*$")
MORE = "**Подробно**"
# "**Скрытность** —; …", "**Скрытность** **+18 (…)**" or "**Скрытность** **КС 23 (…)**".
RE_STEALTH = re.compile(r"^\*\*Скрытность\*\*\s*(?:—|\*\*((?:КС\s+)?[+\-–−]?\d+))")
# Saves are written in the genitive: "спасбросок **Рефлекса КС 20**".
RE_SAVE = re.compile(r"\*\*(Рефлекса|Стойкости|Воли)\s+КС\s+(\d+)\*\*")
SAVE_NAMES = {"Рефлекса": "Рефлекс", "Стойкости": "Стойкость", "Воли": "Воля"}
RE_ATTACK = re.compile(r"атака:\s*\*\*\+(\d+)\*\*")
SIGNED = r"([+\-–−]?\d+)"
# Defenses of a hazard that can be attacked (step 3.15); most hazards have none.
NUMBERS = {
    "ac": re.compile(r"^\*\*КБ\*\*\s*(\d+)"),
    "fort": re.compile(rf"^\*\*Стойкость\*\*\s*{SIGNED}"),
    "ref": re.compile(rf"\*\*Рефлекс\*\*\s*{SIGNED}"),
    "hardness": re.compile(r"^\*\*Твёрдость\*\*\s*(\d+)"),
    "hp": re.compile(r"^\*\*ПЗ\*\*\s*(\d+)"),
    "bt": re.compile(r"\*\*Предел поломки\s+(\d+)\*\*"),
}
# The subsection that starts the notes of a block rather than its rules.
INFO_START = "Обоснование"


def split_block(text):
    """(traits, body, more) of the block section's own text; a trailing "---" is dropped.

    more is the markdown of the "**Подробно**" paragraph or None; the body goes without it.
    """
    traits, kept, more = None, [], None
    for para in paragraphs(text):
        if para.strip().startswith(MORE) and more is None:
            more = para.strip()[len(MORE):].strip()
            continue
        lines = []
        for line in para.splitlines():
            bare = line.strip()
            if bare == "---":
                continue
            m = RE_TRAITS.match(bare)
            if m and traits is None:
                traits = [t.strip() for t in m.group(1).split(",") if t.strip()]
                continue
            lines.append(line)
        if lines:
            kept.append("\n".join(lines))
    return traits, "\n\n".join(kept), more


def parse_stealth(body):
    """(stealth, modifier): "+18" or "КС 23" as written, or None for "—"; the modifier only for "+N"."""
    for line in body.splitlines():
        m = RE_STEALTH.match(line.strip())
        if m:
            value = m.group(1)
            if value is None:
                return None, None
            value = re.sub(r"\s+", " ", value)
            return value, None if value.startswith("КС") else to_int(value)
    return None, None


def parse_numbers(body):
    numbers = {}
    for line in body.splitlines():
        for name, rx in NUMBERS.items():
            m = rx.search(line)
            if m and name not in numbers:
                numbers[name] = to_int(m.group(1))
    return numbers


def find_hazards(docs, problem, taken):
    """Hazards of P7 in canon order; problems go through `problem`.

    `taken` maps the ids already used by creatures to their names: pictures
    of both lie in site/img, so a hazard may not reuse a creature's id.

    Each hazard: id (slug of the name, the image file name), doc, key (the
    block section), name, level, complex, traits, stealth ("+18", "КС 23" or
    null), saves ([{save, dc}] from the rules subsections, in order, without
    repeats), numbers (stealth as a modifier, attack, ac, fort, ref,
    hardness, hp, bt; only those the block states), body (markdown),
    abilities and info (subsections as {key, title, actions}; info starts at
    "Обоснование") and more ([{doc, key}] from "**Подробно**", may be empty).
    """
    hazards, ids = [], dict(taken)
    for doc in (d for d in docs if d["id"] in BLOCK_DOCS):
        sections = doc["sections"]
        children = {}
        for s in sections:
            children.setdefault(s["parent"], []).append(s)
        for section in sections:
            m = RE_LEVEL_TITLE.match(RE_TITLE_NUMBER.sub("", section["title"]))
            if not m:
                continue
            name, level, complex_ = m.group(1).strip(), int(m.group(2)), bool(m.group(3))
            where = (doc["file"], section["line"])
            traits, body, more_text = split_block(section["text"])
            more, missing = more_links(more_text or "", doc, docs)
            for key in missing:
                problem("error", *where, f"в опасности «{name}» ссылка «Подробно» не нашла раздел «{key}»",
                        section["title"])
            if traits is None:
                problem("warning", *where, f"в опасности «{name}» нет строки признаков", section["title"])
            if not any(RE_STEALTH.match(line.strip()) for line in body.splitlines()):
                problem("warning", *where, f"в опасности «{name}» нет строки Скрытности", section["title"])
            stealth, modifier = parse_stealth(body)
            numbers = parse_numbers(body)
            if modifier is not None:
                numbers["stealth"] = modifier

            abilities, info, saves = [], [], []
            for child in children.get(section["key"], []):
                title = RE_ACTIONS.sub("", child["title"])
                actions = RE_ACTIONS.search(child["title"])
                if info or title == INFO_START:
                    info.append({"key": child["key"], "title": title, "actions": None})
                    continue
                abilities.append({"key": child["key"], "title": title,
                                  "actions": actions.group(1) if actions else None})
                for save, dc in RE_SAVE.findall(child["text"]):
                    entry = {"save": SAVE_NAMES[save], "dc": int(dc)}
                    if entry not in saves:
                        saves.append(entry)
                attack = RE_ATTACK.search(child["text"])
                if attack and "attack" not in numbers:
                    numbers["attack"] = int(attack.group(1))
            if not abilities:
                problem("warning", *where, f"в опасности «{name}» нет подраздела с реакцией или действием",
                        section["title"])

            hazard_id = slug(name)
            if hazard_id in ids:
                problem("error", *where, f"id опасности «{hazard_id}» уже занят: «{ids[hazard_id]}»",
                        section["title"])
            ids[hazard_id] = name
            hazards.append({
                "id": hazard_id, "doc": doc["id"], "key": section["key"], "name": name, "level": level,
                "complex": complex_, "traits": traits or [], "stealth": stealth, "saves": saves,
                "numbers": numbers, "body": body, "abilities": abilities, "info": info, "more": more,
            })
    return hazards
