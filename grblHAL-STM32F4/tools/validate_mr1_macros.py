#!/usr/bin/env python3
"""Reject motion or state-changing commands in the phase-zero MR-1 macros."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MACRO_DIR = ROOT / "mr1" / "macros"
MANIFEST_PATH = MACRO_DIR / "manifest.json"
ALLOWED_COMMANDS = {"M5", "M9", "G65P5Q0", "G65P5Q1"}
SAFE_FILE_RE = re.compile(r"[a-z0-9][a-z0-9-]*\.gcode")


class MacroAuditError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise MacroAuditError(message)


def strip_parenthesized_comments(line: str) -> str:
    output: list[str] = []
    depth = 0
    for char in line:
        if char == "(":
            depth += 1
        elif char == ")":
            require(depth > 0, "unbalanced ')' comment delimiter")
            depth -= 1
        elif depth == 0:
            output.append(char)
    require(depth == 0, "unbalanced '(' comment delimiter")
    return "".join(output)


def normalized_commands(text: str) -> list[str]:
    commands: list[str] = []
    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        line = strip_parenthesized_comments(raw_line).split(";", 1)[0]
        command = re.sub(r"\s+", "", line).upper()
        if not command:
            continue
        require(command.isascii(), f"line {line_number}: command is not ASCII")
        require(command in ALLOWED_COMMANDS,
                f"line {line_number}: unsafe or unknown command {command!r}")
        commands.append(command)
    return commands


def audit_macros() -> list[str]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    require(manifest.get("schemaVersion") == 1, "unsupported macro manifest schema")
    require(manifest.get("phase") == 0, "only the phase-zero macro policy is audited")
    require(manifest.get("policy") == "non-motion-only", "macro policy must be non-motion-only")

    entries = manifest.get("macros")
    require(isinstance(entries, list) and entries, "macro manifest is empty")
    listed_files: set[str] = set()

    for entry in entries:
        filename = entry.get("file", "")
        require(SAFE_FILE_RE.fullmatch(filename) is not None,
                f"invalid macro filename {filename!r}")
        require(filename not in listed_files, f"duplicate macro manifest entry {filename}")
        listed_files.add(filename)
        require(entry.get("motion") is False, f"{filename}: motion must be false")

        path = MACRO_DIR / filename
        require(path.is_file(), f"missing macro file {filename}")
        commands = normalized_commands(path.read_text(encoding="ascii"))
        expected = entry.get("exactCommands")
        require(commands == expected,
                f"{filename}: expected {expected!r}, found {commands!r}")

        selections = [command for command in commands if command.startswith("G65P5Q")]
        require(len(selections) == 1, f"{filename}: exactly one probe selection is required")
        expected_selection = {
            "primary": "G65P5Q0",
            "toolsetter": "G65P5Q1",
        }.get(entry.get("finalProbe"))
        require(expected_selection is not None, f"{filename}: invalid finalProbe value")
        require(selections[-1] == expected_selection,
                f"{filename}: final probe selection does not match manifest")
        require(commands[:2] == ["M5", "M9"],
                f"{filename}: spindle and coolant must be stopped before probe selection")

    actual_files = {path.name for path in MACRO_DIR.glob("*.gcode")}
    require(actual_files == listed_files,
            f"unlisted or missing macro files: expected {sorted(listed_files)}, found {sorted(actual_files)}")
    return [f"{len(entries)} phase-zero macros contain only M5, M9, and explicit probe selection"]


def main() -> int:
    try:
        notes = audit_macros()
    except (MacroAuditError, json.JSONDecodeError, UnicodeError) as exc:
        print(f"MR-1 macro audit: FAIL\n{exc}", file=sys.stderr)
        return 1

    print("MR-1 macro audit: PASS")
    for note in notes:
        print(f"- {note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
