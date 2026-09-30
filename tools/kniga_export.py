"""Player book builder for the Time Ship conversion.

Builds kniga_igroka.md, the book handed to the players, from the master
redaction kniga_igroka_master_redaction.md (part 2 of the plan, step 6):
- drops every blockquote: in the master redaction all of them are
  "Мастеру" notes with canon links and spoilers;
- drops "мастерская редакция" from the title and the separator under it.

Player text is edited in the master redaction only; rerun this after that.

Usage: python tools/kniga_export.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "kniga_igroka_master_redaction.md")
TARGET = os.path.join(ROOT, "kniga_igroka.md")

REPLACEMENTS = [
    ("# Провал у сгоревшей фермы. Книга игрока — мастерская редакция\n\n---\n",
     "# Провал у сгоревшей фермы. Книга игрока\n"),
]


def main():
    with open(SOURCE, encoding="utf-8") as f:
        text = "\n".join(line for line in f.read().split("\n") if not line.startswith(">"))
    text = re.sub(r"\n{3,}", "\n\n", text)
    for old, new in REPLACEMENTS:
        if text.count(old) != 1:
            sys.exit(f"expected one match for: {old[:60]!r}")
        text = text.replace(old, new)
    with open(TARGET, "w", encoding="utf-8", newline="\n") as f:
        f.write(text.strip() + "\n")
    print(f"written {os.path.basename(TARGET)}")


if __name__ == "__main__":
    main()
