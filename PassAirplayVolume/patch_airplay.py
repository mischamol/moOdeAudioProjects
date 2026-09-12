#!/usr/bin/env python3
"""Validated AirPlay volume transformations for moOde Audio."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


BEGIN = "# BEGIN MOODE PERSONALIZATIONS: preserve local AirPlay volume"
END = "# END MOODE PERSONALIZATIONS: preserve local AirPlay volume"


class PatchError(ValueError):
    pass


def newline(text: str) -> str:
    return "\r\n" if "\r\n" in text else "\n"


def patch_spspre(text: str) -> str:
    nl = newline(text)
    lines = text.splitlines()
    local = [i for i, line in enumerate(lines) if line.strip() == "# Local"]
    multiroom = [i for i, line in enumerate(lines) if line.strip() == "# Multiroom receivers"]
    if len(local) != 1 or len(multiroom) != 1 or local[0] >= multiroom[0]:
        raise PatchError("could not identify exactly one Local-to-Multiroom block in spspre.sh")
    start, end = local[0], multiroom[0]
    body = lines[start + 1 : end]
    if any(line.strip() == BEGIN for line in body):
        if sum(line.strip() == BEGIN for line in body) != 1 or sum(line.strip() == END for line in body) != 1:
            raise PatchError("invalid managed AirPlay marker block")
        return text

    # Recover the broad sed recipe from the old guide when every nonblank line
    # in the Local block was commented out.
    nonblank = [line for line in body if line.strip()]
    if nonblank and all(re.match(r"^\s*#(?:\s|$)", line) for line in nonblank):
        body = [re.sub(r"^(\s*)# ?", r"\1", line, count=1) if line.strip() else line for line in body]

    normalized = "\n".join(re.sub(r"^\s*#\s?", "", line) for line in body)
    required = ("CDSP_VOLSYNC", "ALSAVOLUME", "set-alsavol", "statefile.yml")
    missing = [token for token in required if token not in normalized]
    if missing:
        raise PatchError("unrecognized Local volume block; missing " + ", ".join(missing))

    managed = [BEGIN, "# Disabled: retain moOde's local volume when AirPlay starts."]
    managed.extend("# " + line if line else "#" for line in body)
    while managed and managed[-1] == "#":
        managed.pop()
    managed.append(END)
    result = lines[: start + 1] + managed + [""] + lines[end:]
    return nl.join(result) + (nl if text.endswith(("\n", "\r\n")) else "")


def unpatch_spspre(text: str) -> str:
    nl = newline(text)
    lines = text.splitlines()
    starts = [i for i, line in enumerate(lines) if line.strip() == BEGIN]
    ends = [i for i, line in enumerate(lines) if line.strip() == END]
    if not starts and not ends:
        return text
    if len(starts) != 1 or len(ends) != 1 or starts[0] >= ends[0]:
        raise PatchError("invalid managed AirPlay marker block")
    managed = lines[starts[0] + 1 : ends[0]]
    if not managed or managed[0].strip() != "# Disabled: retain moOde's local volume when AirPlay starts.":
        raise PatchError("managed AirPlay block was changed; refusing to guess its original content")
    restored = [
        re.sub(r"^(\s*)# ?", r"\1", line, count=1) if line.strip() else line
        for line in managed[1:]
    ]
    result = lines[: starts[0]] + restored + lines[ends[0] + 1 :]
    return nl.join(result) + (nl if text.endswith(("\n", "\r\n")) else "")


OPTION_PATTERNS = {
    "ignore": re.compile(r"^(?P<indent>\s*)(?://\s*)?ignore_volume_control\s*=.*?;.*$"),
    "hook": re.compile(r"^(?P<indent>\s*)(?://\s*)?run_this_when_volume_is_set\s*=.*?;.*$"),
}


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


def restore_shairport(current: str, backup: str, hook: str) -> str:
    nl = newline(current)
    current_lines = current.splitlines()
    current_options = option_lines(current)
    backup_options = option_lines(backup)
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
        current_lines[current_options[name][0]] = backup_options[name][1]
    return nl.join(current_lines) + (nl if current.endswith(("\n", "\r\n")) else "")


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="mode", required=True)
    sps_install = sub.add_parser("spspre-install")
    sps_install.add_argument("input", type=Path)
    sps_install.add_argument("output", type=Path)
    sps_remove = sub.add_parser("spspre-uninstall")
    sps_remove.add_argument("input", type=Path)
    sps_remove.add_argument("output", type=Path)
    sh_install = sub.add_parser("shairport-install")
    sh_install.add_argument("input", type=Path)
    sh_install.add_argument("output", type=Path)
    sh_install.add_argument("hook")
    sh_restore = sub.add_parser("shairport-restore")
    sh_restore.add_argument("input", type=Path)
    sh_restore.add_argument("backup", type=Path)
    sh_restore.add_argument("output", type=Path)
    sh_restore.add_argument("hook")
    args = parser.parse_args()

    current = args.input.read_text(encoding="utf-8")
    if args.mode == "spspre-install":
        result = patch_spspre(current)
    elif args.mode == "spspre-uninstall":
        result = unpatch_spspre(current)
    elif args.mode == "shairport-install":
        result = patch_shairport(current, args.hook)
    else:
        result = restore_shairport(current, args.backup.read_text(encoding="utf-8"), args.hook)
    args.output.write_text(result, encoding="utf-8", newline="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
