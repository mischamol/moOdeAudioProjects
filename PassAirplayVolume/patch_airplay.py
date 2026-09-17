#!/usr/bin/env python3
"""Validated Shairport volume-hook transformations for moOde Audio."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


class PatchError(ValueError):
    pass


OPTION_PATTERNS = {
    "ignore": re.compile(r"^(?P<indent>\s*)(?://\s*)?ignore_volume_control\s*=.*?;.*$"),
    "hook": re.compile(r"^(?P<indent>\s*)(?://\s*)?run_this_when_volume_is_set\s*=.*?;.*$"),
}


def newline(text: str) -> str:
    return "\r\n" if "\r\n" in text else "\n"


def option_lines(text: str) -> dict[str, tuple[int, str, re.Match[str]]]:
    found: dict[str, tuple[int, str, re.Match[str]]] = {}
    lines = text.splitlines()
    for name, pattern in OPTION_PATTERNS.items():
        matches = [(i, line, match) for i, line in enumerate(lines) if (match := pattern.match(line))]
        if len(matches) != 1:
            raise PatchError(f"expected exactly one Shairport option {name}, found {len(matches)}")
        found[name] = matches[0]
    return found


def patch_shairport(text: str, hook: str) -> str:
    nl = newline(text)
    lines = text.splitlines()
    found = option_lines(text)
    ignore_i, _line, ignore_match = found["ignore"]
    hook_i, _line, hook_match = found["hook"]
    lines[ignore_i] = ignore_match.group("indent") + 'ignore_volume_control = "yes";'
    lines[hook_i] = hook_match.group("indent") + f'run_this_when_volume_is_set = "{hook}";'
    return nl.join(lines) + (nl if text.endswith(("\n", "\r\n")) else "")


def restore_shairport(current: str, original: str, hook: str) -> str:
    nl = newline(current)
    current_lines = current.splitlines()
    current_options = option_lines(current)
    original_options = option_lines(original)
    expected_ignore = 'ignore_volume_control = "yes";'
    expected_hook = f'run_this_when_volume_is_set = "{hook}";'
    installed = {
        "ignore": current_options["ignore"][1].strip() == expected_ignore,
        "hook": current_options["hook"][1].strip() == expected_hook,
    }
    if not any(installed.values()):
        return current
    if not all(installed.values()):
        raise PatchError("only part of the managed Shairport configuration remains; refusing a partial restore")
    for name in ("ignore", "hook"):
        current_lines[current_options[name][0]] = original_options[name][1]
    return nl.join(current_lines) + (nl if current.endswith(("\n", "\r\n")) else "")


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="mode", required=True)
    install = sub.add_parser("install")
    install.add_argument("input", type=Path)
    install.add_argument("output", type=Path)
    install.add_argument("hook")
    restore = sub.add_parser("restore")
    restore.add_argument("input", type=Path)
    restore.add_argument("original", type=Path)
    restore.add_argument("output", type=Path)
    restore.add_argument("hook")
    args = parser.parse_args()

    current = args.input.read_text(encoding="utf-8")
    if args.mode == "install":
        result = patch_shairport(current, args.hook)
    else:
        result = restore_shairport(
            current,
            args.original.read_text(encoding="utf-8"),
            args.hook,
        )
    args.output.write_text(result, encoding="utf-8", newline="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
