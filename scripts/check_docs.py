#!/usr/bin/env python3
"""Lightweight documentation consistency check (standard library only).

Fails when documentation points at something that does not exist:
  1. a relative Markdown link or image whose target file is missing;
  2. an in-page anchor (#section) with no matching heading;
  3. a backticked repository path in README.md or docs/SPECIFICATION.md (contains "/", no spaces or wildcards) that does not exist;
  4. the CI badge pointing at a workflow file that does not exist;
  5. in docs/SPECIFICATION.md: a `file::test_name` reference whose file or test function does not exist, a duplicated
     requirement ID, a requirement without a valid status, or a requirement without a traceability row (and vice versa).
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
SPEC = ROOT / "docs" / "SPECIFICATION.md"
STATUSES = ("מתוכננת", "ממומשת", "נבדקה", "הופעלה", "בוטלה", "לא מוגדרת")
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
        is_readme = doc.name == "README.md" and doc.parent == ROOT
        is_spec = doc == SPEC
        if is_readme or is_spec:
            for m in TICK.finditer(text):
                tok = m.group(1).strip()
                path_part, _, test_name = tok.partition("::")
                if PATHLIKE.match(path_part) and not any(c in path_part for c in "*<>$") \
                        and not path_part.startswith(("http", "docs/demo-proof/")) and not path_part.endswith(".env"):
                    target = ROOT / path_part
                    if not target.exists():
                        problems.append(f"{rel}: backticked path '{path_part}' does not exist")
                    elif test_name and is_spec:
                        if not re.search(r"^\s*(async\s+)?def\s+" + re.escape(test_name) + r"\b", target.read_text(encoding="utf-8"), re.M):
                            problems.append(f"{rel}: test '{test_name}' not found in {path_part}")
        if is_readme:
            for wf in re.findall(r"actions/workflows/([\w.\-]+)/badge\.svg", raw):
                if not (ROOT / ".github" / "workflows" / wf).exists():
                    problems.append(f"{rel}: badge points at missing workflow '{wf}'")
        if is_spec:
            req, trace = {}, {}
            for line in text.splitlines():
                m = re.match(r"^\|\s*`?((?:N?FR)-[A-Z0-9]+-\d+)`?\s*\|", line)
                if not m:
                    continue
                rid = m.group(1)
                cells = [c for c in re.split(r"(?<!\\)\|", line.strip().strip("|"))]
                kind = {4: req, 3: trace}.get(len(cells))
                if kind is None:
                    problems.append(f"{rel}: {rid} has {len(cells)} cells, expected 4 (requirement) or 3 (traceability)")
                    continue
                if rid in kind:
                    problems.append(f"{rel}: duplicate requirement ID {rid} in the {'requirement' if kind is req else 'traceability'} tables")
                kind[rid] = cells
                if kind is req and not any(k in cells[3] for k in STATUSES):
                    problems.append(f"{rel}: {rid} has no valid status ({'/'.join(STATUSES)})")
            for rid in sorted(set(req) - set(trace)):
                problems.append(f"{rel}: {rid} has no traceability row")
            for rid in sorted(set(trace) - set(req)):
                problems.append(f"{rel}: traceability row {rid} has no requirement")
            if not req:
                problems.append(f"{rel}: no requirement rows found")
    for p in problems:
        print("DOCS:", p)
    print(f"checked {len([d for d in DOCS if d.exists()])} documents, {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
