#!/usr/bin/env python3
"""Lightweight documentation consistency check (standard library only).

Fails when documentation points at something that does not exist:
  1. a relative Markdown link or image whose target file is missing;
  2. an in-page anchor (#section) with no matching heading;
  3. a backticked repository path in README.md (contains "/", no spaces or wildcards) that does not exist;
  4. the CI badge pointing at a workflow file that does not exist.
It deliberately does NOT compare numbers or prose, and never demands README edits for ordinary code changes.
Run:  python scripts/check_docs.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = [ROOT / "README.md", ROOT / "HANDOFF.md", ROOT / "DEPLOY.md", ROOT / "SECURITY.md", ROOT / "CLAUDE.md",
        *sorted((ROOT / "docs").glob("*.md")), *sorted((ROOT / "backend").glob("README.md")),
        *sorted((ROOT / "tests" / "e2e").glob("README.md"))]
LINK = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
HEAD = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$", re.M)
TICK = re.compile(r"`([^`\n]+)`")
PATHLIKE = re.compile(r"^[\w.\-]+(/[\w.\-]+)+/?$")


def slug(title: str) -> str:
    """GitHub-style anchor: lower-case, drop punctuation except hyphen/space, spaces -> hyphens."""
    t = re.sub(r"`|\*|\[|\]", "", title.strip().lower())
    t = re.sub(r"[^\w\- ]", "", t, flags=re.UNICODE)
    return t.replace(" ", "-")


def strip_code_blocks(text: str) -> str:
    return re.sub(r"```.*?```", "", text, flags=re.S)


def main() -> int:
    problems = []
    for doc in DOCS:
        if not doc.exists():
            continue
        raw = doc.read_text(encoding="utf-8")
        text = strip_code_blocks(raw)
        anchors = {slug(m.group(2)) for m in HEAD.finditer(text)}
        rel = doc.relative_to(ROOT)
        for m in LINK.finditer(text):
            target = m.group(1)
            if re.match(r"^(https?:|mailto:)", target):
                continue
            path, _, frag = target.partition("#")
            if path:
                if not (doc.parent / path).resolve().exists():
                    problems.append(f"{rel}: broken link target '{path}'")
            elif frag and frag not in anchors:
                problems.append(f"{rel}: anchor '#{frag}' has no matching heading")
        if doc.name == "README.md" and doc.parent == ROOT:
            for m in TICK.finditer(text):
                tok = m.group(1).strip()
                if PATHLIKE.match(tok) and not any(c in tok for c in "*<>$") and not tok.startswith(("http", "docs/demo-proof/")) and not tok.endswith(".env"):  # .env files are git-ignored by design
                    if not (ROOT / tok).exists():
                        problems.append(f"{rel}: backticked path '{tok}' does not exist")
            for wf in re.findall(r"actions/workflows/([\w.\-]+)/badge\.svg", raw):
                if not (ROOT / ".github" / "workflows" / wf).exists():
                    problems.append(f"{rel}: badge points at missing workflow '{wf}'")
    for p in problems:
        print("DOCS:", p)
    print(f"checked {len([d for d in DOCS if d.exists()])} documents, {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
