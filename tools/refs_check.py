"""Reference checker for the Time Ship conversion canon.

Collects references to points (пункт N / ПN), sections (раздел X), rooms
(комната N) and local markdown links (including #anchors), and reports those
that point to places that do not exist.

Usage: python tools/refs_check.py [--all] [--anchors FILE]
    --all            also print every resolved reference (inventory mode)
    --anchors FILE   print the heading anchors of FILE and exit

Exit code: 0 if no broken references, 1 otherwise.
"""
import glob
import json
import os
import re
import sys
from urllib.parse import unquote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Source text and the work plan are not canon files with cross-references.
SKIP_FILES = {"korabl_vremeni_ocr.md", "mantiya_ur_ara_istochnik.md", "time_ship_pf2_master_conversion_plan.md"}

# Point 1 of the conversion is the constitution; it has no punkt_1 file.
POINT_FILES = {1: "konstitutsiya_konversii.md"}

NUM = r"\d+(?:\.\d+)*"
NUMLIST = rf"{NUM}(?:\s*(?:,|и|–|-|/)\s*{NUM})*"
POINT_WORD = r"(?:(?<![\w-])[ПP]|пункт\w*)"

RE_HEADING = re.compile(rf"^#+\s+({NUM})\.\s")
RE_SEC_AFTER_POINT = re.compile(rf"(?<![\w-])[ПP](\d+),?\s+раздел\w*\s+({NUMLIST})")
RE_SEC_BEFORE_POINT = re.compile(rf"раздел\w*\s+({NUMLIST})\s+{POINT_WORD}\s*(\d+)")
RE_SEC = re.compile(rf"(?:раздел\w*\s+|см\.\s*)({NUMLIST})")
RE_POINT_TOKEN = re.compile(r"(?<![\w-])[ПP](\d+)")
RE_POINT = re.compile(rf"{POINT_WORD}\s*(\d+(?:\s*(?:–|-|/|,|и)\s*\d+)*)(?![\d.]*\d)")
RE_ROOM = re.compile(rf"(?:комнат\w*|помещени\w*)\s+(?:№\s*)?(\d+(?:\s*(?:–|-|/|,|и)\s*\d+)*)")
RE_LINK = re.compile(r"\]\((?![a-z]+://)([^)#\s]*\.md)?(?:#([^)\s]*))?\)")
RE_TEXT_LINK = re.compile(r"\[([^\]]*)\]\((?![a-z]+://)([^)#\s]+\.md)(?:#[^)\s]*)?\)")
RE_HEADING_TEXT =re.compile(r"^#{1,6}\s+(.*?)\s*#*\s*$")
RE_MD_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")


def split_nums(text):
    return re.findall(NUM, text)


def load_files():
    files = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "*.md"))):
        with open(path, encoding="utf-8") as f:
            files[os.path.basename(path)] = f.read().splitlines()
    return files


def point_map(files):
    points = dict(POINT_FILES)
    for name in files:
        m = re.match(r"korabl_vremeni_punkt_(\d+)_", name)
        if m:
            points[int(m.group(1))] = name
    return points


# Heading characters whose handling in Obsidian anchors is not verified yet.
RISKY_HEADING_CHARS = set("#|^[]")


def obsidian_heading(heading):
    """Heading text as Obsidian matches it in links: colons are dropped."""
    return heading.replace(":", "")


def fragment(heading):
    """Obsidian link fragment: the heading text, URL-encoded where needed."""
    return (obsidian_heading(heading).replace("%", "%25").replace(" ", "%20")
            .replace("(", "%28").replace(")", "%29"))


def anchors(lines):
    """All heading anchors of a file, in order: (heading line, heading text).

    Obsidian anchors are the heading text itself; with duplicate headings a
    link always resolves to the first one.
    """
    result = []
    in_code = False
    for line in lines:
        if line.startswith("```"):
            in_code = not in_code
        if in_code:
            continue
        m = RE_HEADING_TEXT.match(line)
        if m:
            result.append((line, m.group(1)))
    return result


def sections(heads):
    """Section number -> anchors of the headings carrying that number."""
    result = {}
    for line, text in heads:
        m = RE_HEADING.match(line)
        if m:
            result.setdefault(m.group(1), []).append(text)
    return result


def rooms(files):
    p13 = next(n for n in files if "punkt_13_" in n)
    in_text = set()
    in_rooms = False
    for line in files[p13]:
        if line.startswith("## "):
            in_rooms = line.startswith("## Комнаты")
        elif in_rooms and line.startswith("### "):
            m = RE_HEADING.match(line)
            if m:
                in_text.add(int(m.group(1)))
    with open(os.path.join(ROOT, "karta_graf.json"), encoding="utf-8") as f:
        graph = json.load(f)
    on_map = {n["room"] for n in graph["nodes"] if "room" in n}
    return in_text, on_map


def main():
    show_all = "--all" in sys.argv
    files = load_files()
    heads = {name: anchors(lines) for name, lines in files.items()}
    if "--anchors" in sys.argv:
        target = os.path.basename(sys.argv[sys.argv.index("--anchors") + 1])
        for line, text in heads[target]:
            print(f"#{fragment(text)}\n    {line}")
        return 0
    points = point_map(files)
    secs = {name: sections(h) for name, h in heads.items()}
    headings = {name: {obsidian_heading(text) for _, text in h} for name, h in heads.items()}
    rooms_text, rooms_map = rooms(files)
    problems = []
    resolved = []

    def report(kind, name, lineno, line, start, end, msg):
        snippet = line[max(0, start - 50):end + 30].strip()
        problems.append((name, lineno, kind, msg, snippet))

    for name, lines in files.items():
        if name in SKIP_FILES:
            continue
        for lineno, line in enumerate(lines, 1):
            covered = []

            # Sections qualified by a point: "П12, раздел 9" / "раздел 9 пункта 12".
            qualified = [(m, int(m.group(1)), m.group(2)) for m in RE_SEC_AFTER_POINT.finditer(line)]
            qualified += [(m, int(m.group(2)), m.group(1)) for m in RE_SEC_BEFORE_POINT.finditer(line)]
            for m, point, nums in qualified:
                covered.append(m.span())
                target = points.get(point)
                if target is None:
                    report("section", name, lineno, line, *m.span(), f"пункт {point} не существует")
                    continue
                for n in split_nums(nums):
                    if n in secs[target]:
                        resolved.append((name, lineno, f"П{point} раздел {n}"))
                    else:
                        report("section", name, lineno, line, *m.span(), f"в П{point} нет раздела {n}")

            # Bare "раздел X": the nearest preceding "ПN" in the same table
            # cell ("П8 — Пёс; разделы 18.2–18.3"), otherwise the current file.
            for m in RE_SEC.finditer(line):
                if any(a <= m.start() < b for a, b in covered):
                    continue
                cell = line[:m.start()].rsplit("|", 1)[-1]
                owners = [int(t) for t in RE_POINT_TOKEN.findall(cell)]
                owner = points.get(owners[-1]) if owners else None
                # Inside link text the section belongs to the link target:
                # "[Словарь, раздел 6](slovar_terminov.md#…)".
                for link in RE_TEXT_LINK.finditer(line):
                    if link.start(1) <= m.start() < link.end(1) and link.group(2) in secs:
                        owner, owners = link.group(2), [link.group(2)]
                for n in split_nums(m.group(1)):
                    if owner and n in secs[owner]:
                        resolved.append((name, lineno, f"{owners[-1]} раздел {n}"))
                    elif n in secs[name]:
                        resolved.append((name, lineno, f"раздел {n} (локально)"))
                    else:
                        report("section", name, lineno, line, *m.span(), f"в этом файле нет раздела {n}")

            for m in RE_POINT.finditer(line):
                for n in re.findall(r"\d+", m.group(1)):
                    if int(n) in points:
                        resolved.append((name, lineno, f"пункт {n}"))
                    else:
                        report("point", name, lineno, line, *m.span(), f"пункт {n} не существует")

            for m in RE_ROOM.finditer(line):
                for n in re.findall(r"\d+", m.group(1)):
                    n = int(n)
                    if n not in rooms_text:
                        report("room", name, lineno, line, *m.span(), f"комнаты {n} нет в П13")
                    elif n not in rooms_map:
                        report("room", name, lineno, line, *m.span(), f"комнаты {n} нет на карте")
                    else:
                        resolved.append((name, lineno, f"комната {n}"))

            for m in RE_LINK.finditer(line):
                target, anchor = m.group(1) or name, m.group(2)
                if not m.group(1) and anchor is None:
                    continue
                if anchor is not None:
                    anchor = unquote(anchor)
                if not os.path.exists(os.path.join(ROOT, target)):
                    report("link", name, lineno, line, *m.span(), f"файл {target} не найден")
                elif anchor is None or target not in headings:
                    resolved.append((name, lineno, f"ссылка {target}"))
                elif anchor in headings[target]:
                    resolved.append((name, lineno, f"ссылка {target}#{anchor}"))
                else:
                    report("link", name, lineno, line, *m.span(), f"в {target} нет якоря #{anchor}")

    if show_all:
        for name, lineno, what in resolved:
            print(f"ok  {name}:{lineno}  {what}")
        print()

    missing_on_map = sorted(rooms_text - rooms_map)
    if missing_on_map:
        print(f"Комнаты П13 без узла на карте: {missing_on_map}\n")

    current = None
    for name, lineno, kind, msg, snippet in sorted(problems):
        if name != current:
            print(f"== {name}")
            current = name
        print(f"  {lineno:>5}  [{kind}] {msg}\n         … {snippet} …")
    print(f"\nВсего ссылок: {len(resolved) + len(problems)}, битых: {len(problems)}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
