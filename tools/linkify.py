"""Turn textual cross-references into Obsidian-compatible markdown links.

Rules (step 5.2 of the work plan):
- exact section references ("П12, раздел 9", "раздел 6 пункта 5", local
  "раздел 15", "см. 15.2") become links every time; in lists
  ("разделы 9, 17") each number becomes its own link;
- bare point references ("П9", "пункт 7") become a link to the file only on
  their first mention inside each "##" section, and never to the file itself;
- ranges ("пункты 1–12"), headings, code spans and existing links stay as is.

Links use the heading text as the fragment, as Obsidian writes them:
[П5, раздел 5.1](korabl_vremeni_punkt_5_fundamentalnye_sistemy.md#5.1.%20Формула%20маршрута)

Usage: python tools/linkify.py FILE... [--dry-run]
"""
import os
import re
import sys

from refs_check import (RE_POINT, RE_POINT_TOKEN, RE_SEC, RE_SEC_AFTER_POINT,
                        RE_SEC_BEFORE_POINT, RISKY_HEADING_CHARS, ROOT, NUM,
                        anchors, fragment, load_files, point_map, sections)

RE_PROTECTED = re.compile(r"\[[^\]]*\]\([^)]*\)|`[^`]*`")
RE_RANGE = re.compile(r"\d\s*[–-]\s*\d")


def link(text, target, current, heading=None):
    href = "" if target == current else target
    if heading is not None:
        href += "#" + fragment(heading)
    return f"[{text}]({href})"


def link_numbers(m, group, make):
    """Link each number of a list group separately, keeping the rest as text."""
    start, end = m.span(group)
    parts, pos = [], m.start()
    for n in re.finditer(NUM, m.string[start:end]):
        a, b = start + n.start(), start + n.end()
        parts.append(m.string[pos:a])
        parts.append(make(n.group(0)))
        pos = b
    parts.append(m.string[pos:m.end()])
    return "".join(parts)


class Linker:
    def __init__(self):
        self.files = load_files()
        self.points = point_map(self.files)
        self.secs = {n: sections(anchors(l)) for n, l in self.files.items()}
        self.unresolved = []

    def heading(self, target, number):
        found = self.secs[target].get(number)
        return found[0] if found else None

    def section_link(self, text, point_file, number, current):
        heading = self.heading(point_file, number)
        if heading is None or RISKY_HEADING_CHARS & set(heading):
            self.unresolved.append((current, text, number))
            return text
        return link(text, point_file, current, heading)

    def convert_line(self, line, current, seen):
        protected = [m.span() for m in RE_PROTECTED.finditer(line)]
        edits = []  # (start, end, replacement)

        def free(a, b):
            return not any(a < y and x < b for x, y in protected + [(s, e) for s, e, _ in edits])

        def add(a, b, text):
            if free(a, b):
                edits.append((a, b, text))

        qualified = [(m, 1, 2) for m in RE_SEC_AFTER_POINT.finditer(line)]
        qualified += [(m, 2, 1) for m in RE_SEC_BEFORE_POINT.finditer(line)]
        for m, pg, ng in qualified:
            target = self.points.get(int(m.group(pg)))
            if target is None or not free(*m.span()):
                continue
            nums = re.findall(NUM, m.group(ng))
            if len(nums) == 1:
                text = self.section_link(m.group(0), target, nums[0], current)
            else:
                text = link_numbers(m, ng, lambda n: self.section_link(n, target, n, current))
            add(*m.span(), text)

        for m in RE_SEC.finditer(line):
            if not free(*m.span()):
                continue
            cell = line[:m.start()].rsplit("|", 1)[-1]
            owners = [int(t) for t in RE_POINT_TOKEN.findall(cell)]
            owner = self.points.get(owners[-1]) if owners else None
            nums = re.findall(NUM, m.group(1))

            def resolve(n):
                if owner and self.heading(owner, n):
                    return self.section_link(n, owner, n, current)
                return self.section_link(n, current, n, current)

            if len(nums) == 1 and not line[m.start():m.start(1)].startswith("см"):
                target = owner if owner and self.heading(owner, nums[0]) else current
                text = self.section_link(m.group(0), target, nums[0], current)
            else:
                text = link_numbers(m, 1, resolve)
            add(*m.span(), text)

        for m in RE_POINT.finditer(line):
            if RE_RANGE.search(m.group(1)) or not free(*m.span()):
                continue
            nums = [int(n) for n in re.findall(r"\d+", m.group(1))]
            targets = {n: self.points.get(n) for n in nums}
            fresh = [n for n in nums if targets[n] and targets[n] != current and n not in seen]
            if not fresh:
                continue
            # A list with one fresh number is linked whole, so it does not look broken.
            linked = [n for n in nums if targets[n] and targets[n] != current]
            seen.update(linked)

            def point(n):
                n = int(n)
                return link(str(n), targets[n], current) if n in linked else str(n)

            if len(nums) == 1:
                text = link(m.group(0), targets[nums[0]], current)
            else:
                text = link_numbers(m, 1, point)
            add(*m.span(), text)

        for a, b, text in sorted(edits, reverse=True):
            line = line[:a] + text + line[b:]
        return line

    def convert(self, name):
        out, seen, in_code = [], set(), False
        for line in self.files[name]:
            if line.startswith("```"):
                in_code = not in_code
            if line.startswith("## ") or line.startswith("# "):
                seen = set()
            if in_code or line.startswith("#"):
                out.append(line)
            else:
                out.append(self.convert_line(line, name, seen))
        return out


def main():
    dry = "--dry-run" in sys.argv
    names = [os.path.basename(a) for a in sys.argv[1:] if not a.startswith("--")]
    linker = Linker()
    for name in names:
        old = linker.files[name]
        new = linker.convert(name)
        changed = sum(a != b for a, b in zip(old, new))
        print(f"{name}: изменено строк {changed}")
        if not dry and changed:
            path = os.path.join(ROOT, name)
            with open(path, encoding="utf-8", newline="") as f:
                eol = "\r\n" if "\r\n" in f.read() else "\n"
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(eol.join(new) + eol)
    for current, text, number in linker.unresolved:
        print(f"  не найден раздел {number}: {current} … {text}")


if __name__ == "__main__":
    main()
