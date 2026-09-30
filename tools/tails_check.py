"""Leftover checker for the Time Ship conversion canon.

Finds traces of earlier passes that are not contradictions but still wrong:
- forward references ("будет определено в пункте 7") to points that are done;
- removed hazard and milestone codes (О-04, K1);
- variants the glossary replaced (slovar_terminov.md, sections 1, 2, 4 and 3),
  item names written without the capital letters of section 5, the
  Reflex save written as "Реакция" and the manipulate trait written as
  "воздействие";
- trait lines of stat blocks ("**Признаки:**") without the colon or with a
  trait missing from the glossary list (section 8, "Признаки");
- creature stat blocks of P9 and P11 split across sections or missing a
  level, the trait line, AC, HP or Speed;
- facts of the old source transcription that the new one removed (step 10:
  the syringe reward, the crystal pin, the "Enemy of Time", the morion
  portal and so on);
- levels the campaign dropped in step 11 (the range 3-6, the d20 and d30
  encounter tables, budgets against parties of level 5 and 6);
- rooms of P13 without a "**Связанные системы:**" line, or with a point or
  a room named in it without a link: the site reads the room's cards from
  these links (site step 3.12b).
- room flags of P13 written in their own names (`рост_8_футы`): the state
  of the ship lives in the P2 sheet, and a room names its fields as
  `ГРУППА · Поле` (site step 3.12c);
- states of a P13 room in backticks that name no sheet field (`веко
  закрыто`) and are not a trigger "условие → следствие", a die (`d6`,
  `2-к-6`), a pair of rooms (`19↔41`) or a row of numbers, and names glued
  to a number (`часы39`); whether a trigger names its sheet values cannot
  be checked here (site step 3.12f);
- random encounter cards of P10 ("### № N.") without a "**Связанные
  системы:**" line in their own section, or with a point or a room named in
  it without a link: the site reads the row's cards from these links (site
  step 3.14a).

It also finds unresolved-question markers in points P2-P14 ("Требуется
решение Мастера", "нерешённый", "не определено" next to "решение" or
"исходник"). Register exceptions (otkrytye_voprosy.md, section "Не считается
открытым вопросом") are skipped.

Usage: python tools/tails_check.py [FILE...]   (default: all canon files)
Exit code: 0 if nothing found, 1 otherwise.
"""
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLOSSARY = "slovar_terminov.md"
SKIP = {"korabl_vremeni_ocr.md", "mantiya_ur_ara_istochnik.md", "time_ship_pf2_master_conversion_plan.md", GLOSSARY,
        "rashozhdeniya.md", "otkrytye_voprosy.md"}

RE_FORWARD = re.compile(
    r"(будет|будут)\s[^.]{0,80}(пункт|П\d)|отклад\w* до [^.]{0,20}пункт"
    r"|сейчас намеренно не задаётся|позднее[^.]{0,60}пункт\w* \d"
    r"|будущ\w*\s+(блок\w*|КС)|[Пп]ока\s+будущ"
    r"|отклад\w* до (конверси|блок)\w*|разработан\w* позже|[Вв] дальнейшем,? в \[?пункт")
RE_CODES = re.compile(r"(?<![\w-])([ОСЗПO]-\d{2}|[KSTFR]\d)(?![\w-])")
RE_REFLEX = re.compile(r"(спасброс\w*|КС)\s+\**Реакци|\bРеакци\w*\s+(КС\s+)?\d")
# The manipulate trait is "манипуляция"; "воздействие" stays allowed as a plain word,
# so only trait positions are checked: after "признак", in a trait list or after "/".
RE_MANIPULATE = re.compile(r"признак\w*\s+«?воздействи|[(/]\s*воздействие\b|,\s*воздействие\s*\)")
# A stat block trait line; the glossary lists every trait it may hold.
RE_TRAIT_LINE = re.compile(r"^\*\*Признаки(:?)\*\*:?\s*(.*)$")
# Creature stat blocks (P9, P11): the level, and the lines every block holds.
BLOCK_FILES = re.compile(r"korabl_vremeni_punkt_(9|11)_")
RE_HEADING = re.compile(r"^#{1,6}\s")
RE_BLOCK_LEVEL = re.compile(r"^#{1,6}\s.*—\s*Существо\s+-?\d+\s*$|^\*\*Существо\s+-?\d+")
RE_BLOCK_PROFILE = re.compile(r"^\*\*Числовая калибровка:\*\*\s*\d+-й уровень")
BLOCK_FIELDS = {"Признаки": re.compile(r"^\*\*Признаки:\*\*"), "КБ": re.compile(r"^\*\*КБ\*\*"),
                "ПЗ": re.compile(r"^\*\*ПЗ\*\*"), "Скорость": re.compile(r"^\*\*Скорость\*\*")}
# Rulebook titles contain banned variants ("GM") but are proper names.
RE_BOOKS = re.compile(r"\b(GM|Player|Monster) Core\b")
# Old-transcription facts dropped by the re-transcribed source (plan step 10).
RE_OLD_SOURCE = re.compile(
    r"шприц|штифт|Враг\w* Времени|эксцентричн|антропосинтет|безволос"
    r"|морион\w* (портал|арк)|Морионов\w* мерцани|[Хх]рупк\w* стен\w* провал"
    r"|поворотн\w* кристалл|вещи_помещ", re.IGNORECASE)
# Levels the campaign no longer has (plan step 11: the party goes 3 -> 4 only).
RE_OLD_LEVELS = re.compile(
    r"3–6 уровн|уровн\w* 3–6|уровн\w* 5–6|1d30|партии 5|партии 6"
    r"|для группы 5-го|для группы 6-го|до 6-го уровня", re.IGNORECASE)

# Section 3 abbreviations the glossary spells out (rows with codes are covered above).
ABBREVIATIONS = ["УП", "СК", "КЗ", "НР", "АПОКБ0"]

# Unresolved-question markers (plan_dovedeniya_kanona.md, stage 8.0).
MARKER_FILES = re.compile(r"korabl_vremeni_punkt_\d+_")
# "Принятые", "произвольное", "без", "нового" and "не" decisions are not open questions.
RE_MARKER = re.compile(
    r"(?<!принятых )(?<!Зафиксированные )(?<!произвольного )(?<!произвольным )"
    r"(?<!без )(?<!нового )(?<!не )решени\w* Мастера|[Нн]ерешённ\w*|решение отложенного вопроса")
# Descriptive "не установлено" is a statement about a character; it counts
# only when the same sentence speaks about a decision or the source.
RE_MARKER_WEAK = re.compile(r"не (определен|установлен)\w*")
RE_MARKER_CONTEXT = re.compile(r"решени|исходник", re.IGNORECASE)
MARKER_EXCEPTIONS = [
    re.compile(r"решение Мастера о подаче информации"),  # P4 calibrator template
]

# PF2 spells (glossary section 7, table in section 8). The plan log keeps its wording;
# section 1 of the threat ladder speaks of OSE spells, which get no link.
SPELL_SKIP_FILES = {"plan_dovedeniya_kanona.md"}
SPELL_SKIP_SECTIONS = {"lestnitsa_ugroz.md": "## 1."}
RE_ITALIC = re.compile(r"(?<![*\w])\*([^*\n]+?)\*(?![*\w])")
RE_SPELL_LINK = re.compile(r"\s*\(\[[^\]]+\]\(https://2e\.aonprd\.com/Spells\.aspx\?ID=(\d+)\)")
RE_NOT_ITALIC = re.compile(r"\*\*«([^»\n]+)»\*\*|«([^»\n]+)»|`([^`\n]+)`|\*\*([^*\n]+)\*\*")
RE_LINK = re.compile(r"\[[^\]]*\]\([^)]*\)")
# Names that share a stem with a spell but are not spells: the action «Починить» (Repair) is not
# *Починка* (Mending), the class **Страж** (Guardian) is not *Страх* (Fear).
NOT_SPELL_NAMES = {"Починить", "Страж"}


def marker_hits(text):
    """Unresolved-question markers in one line of a point file."""
    if any(rx.search(text) for rx in MARKER_EXCEPTIONS):
        return []
    hits = [("метка", m) for m in RE_MARKER.finditer(text)]
    for m in RE_MARKER_WEAK.finditer(text):
        start = max(text.rfind(". ", 0, m.start()), text.rfind("|", 0, m.start())) + 1
        end = min(i for i in (text.find(". ", m.end()), text.find("|", m.end()), len(text)) if i >= 0)
        if RE_MARKER_CONTEXT.search(text[start:end]):
            hits.append(("метка", m))
    return hits


def glossary_rules():
    """Banned variants from table sections 1, 2, 4 and item names from section 5."""
    variants, names, section = [], [], ""
    with open(os.path.join(ROOT, GLOSSARY), encoding="utf-8") as f:
        for line in f:
            if line.startswith("## "):
                section = line[3:].split(".")[0]
                continue
            if section in ("1", "2", "4") and line.startswith("| **"):
                cells = [c.strip() for c in line.strip().strip("|").split("|")]
                if len(cells) < 2:
                    continue
                for v in re.split(r",\s*", cells[1]):
                    v = re.sub(r"[*«»]", "", v).strip()
                    if v and v != "—" and "(" not in v and len(v) > 1:
                        variants.append(v)
            if section == "5" and line.startswith("- **"):
                names.append(re.match(r"- \*\*([^*]+)\*\*", line).group(1))
    return variants, names


def trait_table():
    """Trait names of the glossary list (section 8, subsection "Признаки")."""
    traits, inside = set(), False
    with open(os.path.join(ROOT, GLOSSARY), encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                inside = line.strip() == "### Признаки"
            elif inside and line.startswith("| ") and not line.startswith("| Русское название"):
                traits.add(line.split("|")[1].strip())
    return traits


def trait_hits(line, traits):
    """A trait line without the colon, and traits the glossary does not list."""
    m = RE_TRAIT_LINE.match(line)
    if not m:
        return []
    hits = [] if m.group(1) else [("строка признаков без двоеточия", m)]
    # A note after a dash names the source of the traits: "— по заклинанию *Слабоумие*".
    for trait in m.group(2).split(" — ")[0].split(","):
        trait = trait.strip()
        if trait and trait not in traits:
            hits.append((f"признака «{trait}» нет в словаре", re.search(re.escape(trait), line)))
    return hits


def block_hits(lines):
    """Incomplete creature stat blocks of P9 and P11, as (lineno, message, match).

    A section (heading to heading) holds a block when it states a level: a
    heading "… — Существо N" or a line "**Существо N…". Such a section must
    also hold the trait line, AC, HP and Speed, so that the whole block lies
    in one section and the site reads it without guessing. The Shell's
    profile states its level as "**Числовая калибровка:**" and has no traits.
    """
    sections, current = [], None
    for lineno, line in enumerate(lines, 1):
        if RE_HEADING.match(line):
            current = {"line": lineno, "heading": line, "fields": set(), "level": None, "profile": False}
            sections.append(current)
        elif current is None:
            continue
        if RE_BLOCK_LEVEL.match(line) or RE_BLOCK_PROFILE.match(line):
            current["level"] = current["level"] or lineno
            current["profile"] = current["profile"] or bool(RE_BLOCK_PROFILE.match(line))
        for field, rx in BLOCK_FIELDS.items():
            if rx.match(line):
                current["fields"].add(field)
    hits = []
    for s in sections:
        has_block = "КБ" in s["fields"]
        if not s["level"] and not has_block:
            continue
        need = [f for f in BLOCK_FIELDS if not (s["profile"] and f == "Признаки")]
        missing = [f for f in need if f not in s["fields"]]
        if not s["level"]:
            missing.insert(0, "уровень")
        if missing:
            hits.append((s["line"], f"блок характеристик без: {', '.join(missing)}",
                         re.match(r".*", s["heading"])))
    return hits


def spell_table():
    """(name, AoN ID, pre-Remaster name or None, pattern) for every row of the glossary spell table."""
    spells, section = [], ""
    with open(os.path.join(ROOT, GLOSSARY), encoding="utf-8") as f:
        for line in f:
            if line.startswith("## "):
                section = line[3:].split(".")[0]
            elif line.startswith("### "):
                section = ""
            elif section == "8" and line.startswith("| ") and "ID=" in line:
                cells = [c.strip() for c in line.strip().strip("|").split("|")]
                spell_id = re.search(r"ID=(\d+)", cells[3]).group(1)
                # A spell missing from Remaster keeps its old name as the link text.
                old = cells[2] if cells[2] != "—" and cells[1] != "нет в Remaster" else None
                spells.append((cells[0], spell_id, old, spell_pattern(cells[0])))
    return spells


def spell_pattern(name):
    """Case-insensitive full-name pattern for a declinable spell name."""
    stems = [w[:max(len(w) - 2, min(len(w), 4))] for w in name.split()]
    return re.compile(r"\w*\s+".join(map(re.escape, stems)) + r"\w*", re.IGNORECASE)


def spell_hits(line, spells, seen):
    """Section 7 violations in one line; `seen` holds spells already met in the file."""
    hits = []
    for m in RE_NOT_ITALIC.finditer(line):
        inner = next(g for g in m.groups() if g is not None).strip()
        if inner in NOT_SPELL_NAMES:
            continue
        for name, _, _, rx in spells:
            # Lowercase is a condition or a trait ("парализован", "страх"), not a spell.
            if inner[:1].isupper() and rx.fullmatch(inner):
                hits.append((f"заклинание «{name}» не курсивом", m))
    for m in RE_ITALIC.finditer(line):
        for name, spell_id, old, rx in spells:
            if not rx.fullmatch(m.group(1)):
                continue
            if m.group(1)[0].islower():
                hits.append((f"заклинание «{name}» со строчной", m))
            link = RE_SPELL_LINK.match(line, m.end())
            if name not in seen:
                seen.add(name)
                if not link:
                    hits.append((f"первое упоминание «{name}» без ссылки", m))
                elif link.group(1) != spell_id:
                    hits.append((f"ID «{name}» не {spell_id}", m))
                elif old and not line.startswith(f"; до Remaster — {old})", link.end()):
                    hits.append((f"у «{name}» нет прежнего названия {old}", m))
            elif link:
                hits.append((f"ссылка «{name}» не при первом упоминании", m))
    # A bare mention is caught only for multi-word names: one-word names
    # ("Страх", "Щит", "Перемещение") are ordinary words too.
    bare = re.sub(r"«[^»\n]*»|`[^`\n]*`", "", RE_ITALIC.sub("", RE_LINK.sub("", line))).replace("**", "")
    for name, _, _, rx in spells:
        if " " in name:
            for m in rx.finditer(bare):
                if m.group(0)[0].isupper():
                    hits.append((f"заклинание «{name}» без курсива", m))
    return hits


def name_pattern(name):
    """Case-insensitive pattern for a declinable multi-word item name."""
    stems = [w[:max(4, len(w) - 2)] for w in name.split()]
    return re.compile(r"\b" + r"\w*\s+".join(map(re.escape, stems)) + r"\w*", re.IGNORECASE)


ROOMS_FILE = "korabl_vremeni_punkt_13_room_by_room_pf2_overlay.md"
RE_ROOM = re.compile(r"^### (\d+)\. ")
RELATED = "**Связанные системы:**"
# A flag of its own name in backticks: Cyrillic words joined by "_".
RE_OLD_FLAG = re.compile(r"`[^`\n]*[а-яё]_[а-яё0-9][^`\n]*`", re.IGNORECASE)
# A backtick span of a room: a sheet field ("ГРУППА · Поле"), a trigger, or
# notation that is no state at all.
RE_SPAN = re.compile(r"`([^`\n]+)`")
RE_FIELD_REF = re.compile(r"[А-ЯЁ][А-ЯЁ0-9 /]* · ")
RE_NOTATION = re.compile(r"\d*d\d+|\d+-к-\d+|\d+↔\d+|[\d/%]+")
RE_GLUED = re.compile(r"[а-яё]\d")
# Outside link texts the line may name no point ("П7") and no room ("комната 4").
RE_UNLINKED = re.compile(r"(?<![\w-])П\d+(?![\w-])|комнат\w*\s+\d+")


def room_hits(lines):
    """Rooms of P13 whose related-systems line is missing or names something without a link,
    flags of their own names instead of the P2 sheet fields, and states in
    backticks that name no sheet field."""
    hits, room, seen = [], None, set()
    for lineno, line in enumerate(lines, 1):
        for flag in RE_OLD_FLAG.finditer(line):
            hits.append((lineno, "флаг вне листа П2", flag))
        m = RE_ROOM.match(line)
        if m:
            room = (int(m.group(1)), lineno, line)
        elif line.startswith("## "):
            room = None
        for span in (RE_SPAN.finditer(line) if room else []):
            code = span.group(1)
            if RE_GLUED.search(code):
                hits.append((lineno, "имя, склеенное с номером", span))
            elif not (RE_FIELD_REF.search(code) or "→" in code or RE_NOTATION.fullmatch(code)):
                hits.append((lineno, "состояние вне листа П2", span))
        if room and line.startswith(RELATED):
            seen.add(room[0])
            bare = re.sub(r"\[[^\]]*\]\([^)]*\)", "[]", line[len(RELATED):])
            for u in RE_UNLINKED.finditer(bare):
                hits.append((lineno, "связи комнаты без ссылки", u))
        if room and room[0] not in seen and (lineno == len(lines) or RE_ROOM.match(lines[lineno])
                                              or lines[lineno].startswith("## ")):
            hits.append((room[1], "комната без строки «Связанные системы»", re.match(r".*", room[2])))
            seen.add(room[0])
    return hits


ENCOUNTERS_FILE = "korabl_vremeni_punkt_10_sluchaynye_vstrechi.md"
RE_CARD = re.compile(r"^### № (\d+)\. ")


def encounter_hits(lines):
    """Cards of P10 whose related-systems line is missing from the card's own
    section (before its first subsection) or names something without a link."""
    hits, card, seen = [], None, set()
    for lineno, line in enumerate(lines, 1):
        if line.startswith("#"):
            if card and card[0] not in seen:
                hits.append((card[1], "карточка без строки «Связанные системы»", re.match(r".*", card[2])))
            m = RE_CARD.match(line)
            card = (int(m.group(1)), lineno, line) if m else None
        if card and line.startswith(RELATED):
            seen.add(card[0])
            bare = re.sub(r"\[[^\]]*\]\([^)]*\)", "[]", line[len(RELATED):])
            for u in RE_UNLINKED.finditer(bare):
                hits.append((lineno, "связи карточки без ссылки", u))
    if card and card[0] not in seen:
        hits.append((card[1], "карточка без строки «Связанные системы»", re.match(r".*", card[2])))
    return hits


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    args = [os.path.basename(a) for a in sys.argv[1:]]
    names = args or sorted(os.path.basename(p) for p in glob.glob(os.path.join(ROOT, "*.md")))
    variants, items = glossary_rules()
    checks = [("отсылка вперёд", RE_FORWARD), ("код", RE_CODES), ("Рефлекс", RE_REFLEX),
              ("манипуляция", RE_MANIPULATE), ("старая оцифровка", RE_OLD_SOURCE),
              ("старые уровни", RE_OLD_LEVELS)]
    checks += [("словарь", re.compile(rf"(?<![\w-]){re.escape(v)}(?![\w-])")) for v in variants]
    checks += [("словарь", re.compile(rf"(?<![\w-]){a}(?![\w-])")) for a in ABBREVIATIONS]
    item_checks = [(n, name_pattern(n)) for n in items]
    spells = spell_table()
    traits = trait_table()
    found = 0
    for name in names:
        if name in SKIP:
            continue
        with open(os.path.join(ROOT, name), encoding="utf-8") as f:
            lines = f.read().split("\n")
        in_code = False
        spell_file = name not in SPELL_SKIP_FILES
        spell_skip = SPELL_SKIP_SECTIONS.get(name)
        in_skip, seen = False, set()
        for lineno, line in enumerate(lines, 1):
            if line.startswith("```"):
                in_code = not in_code
            if spell_skip and line.startswith("## "):
                in_skip = line.startswith(spell_skip)
            # English names in Archives of Nethys links and the pre-Remaster names after them
            # are required by glossary section 7.
            text = re.sub(r"\[[^\]]*\]\(https://2e\.aonprd\.com[^)]*\)(; до Remaster — [^)]*)?", "[]", line)
            text = re.sub(r"\]\([^)]*\)", "]", text)
            text = RE_BOOKS.sub("", text)
            hits = [(kind, m) for kind, rx in checks for m in rx.finditer(text)]
            if MARKER_FILES.match(name):
                hits += marker_hits(text)
                hits += trait_hits(line, traits)
            # Headings keep plain spell names (Obsidian anchors); the first mention is in the text.
            if spell_file and not in_skip and not in_code and not line.startswith("#"):
                hits += spell_hits(line, spells, seen)
            for item, rx in item_checks:
                for m in rx.finditer(text):
                    expected = [w[0].isupper() for w in item.split()]
                    if [w[0].isupper() for w in m.group(0).split()] != expected:
                        hits.append((f"название «{item}»", m))
            for kind, m in hits:
                found += 1
                a, b = max(0, m.start() - 40), m.end() + 30
                print(f"{name}:{lineno}  [{kind}] …{m.string[a:b].strip()}…")
        if name == ROOMS_FILE:
            for lineno, kind, m in room_hits(lines):
                found += 1
                print(f"{name}:{lineno}  [{kind}] {m.group(0).strip()}")
        if name == ENCOUNTERS_FILE:
            for lineno, kind, m in encounter_hits(lines):
                found += 1
                print(f"{name}:{lineno}  [{kind}] {m.group(0).strip()}")
        if BLOCK_FILES.match(name):
            for lineno, kind, m in block_hits(lines):
                found += 1
                print(f"{name}:{lineno}  [{kind}] {m.group(0).strip()}")
    print(f"\nНайдено хвостов: {found}")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
