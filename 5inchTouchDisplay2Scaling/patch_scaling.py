#!/usr/bin/env python3
"""Apply or remove the managed moOde Chromium scaling block."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


BEGIN = "# BEGIN MOODE PERSONALIZATIONS: display scaling"
END = "# END MOODE PERSONALIZATIONS: display scaling"


class PatchError(ValueError):
    pass


def newline(text: str) -> str:
    return "\r\n" if "\r\n" in text else "\n"


def webui_bounds(lines: list[str]) -> tuple[int, int]:
    starts = [
        i for i, line in enumerate(lines)
        if re.match(r"^\s*if\s+\[\s+\$WEBUI_SHOW\s+=\s+['\"]?1['\"]?\s+\];\s+then\s*$", line)
    ]
    if len(starts) != 1:
        raise PatchError(f"expected one WEBUI_SHOW block, found {len(starts)}")
    start = starts[0]
    ends = [
        i for i in range(start + 1, len(lines))
        if re.match(r"^\s*elif\s+\[\s+\$PEPPY_SHOW", lines[i])
    ]
    if not ends:
        raise PatchError("could not find the PEPPY_SHOW boundary after WEBUI_SHOW")
    return start, ends[0]


def apply_scaling(text: str, factor: int) -> str:
    if factor < 1:
        raise PatchError("scale factor must be at least 1")
    nl = newline(text)
    lines = text.splitlines()
    start, end = webui_bounds(lines)

    # Remove our previous block so rerunning can also change the factor.
    cleaned: list[str] = []
    managed = False
    for line in lines:
        if line.strip() == BEGIN:
            if managed:
                raise PatchError("nested scaling marker")
            managed = True
            continue
        if line.strip() == END:
            if not managed:
                raise PatchError("scaling end marker without start")
            managed = False
            continue
        if not managed:
            cleaned.append(line)
    if managed:
        raise PatchError("unterminated scaling marker")
    lines = cleaned
    start, end = webui_bounds(lines)

    # Also normalize the three-line recipe when it was added manually.
    manual = (
        re.compile(r"^\s*SCALE_FACTOR\s*=.*$"),
        re.compile(r"^\s*WIDTH=\$\(\(\s*\$?\{SCREEN_RES%,\*\}\s*/\s*SCALE_FACTOR\s*\)\)\s*$"),
        re.compile(r"^\s*HEIGHT=\$\(\(\s*\$?\{SCREEN_RES#\*,\}\s*/\s*SCALE_FACTOR\s*\)\)\s*$"),
    )
    lines = [
        line for i, line in enumerate(lines)
        if not (start < i < end and any(pattern.match(line) for pattern in manual))
    ]
    start, end = webui_bounds(lines)
    lines = [
        line for i, line in enumerate(lines)
        if not (
            start < i < end
            and re.match(r"^\s*--force-device-scale-factor=.*\\\s*$", line)
        )
    ]
    start, end = webui_bounds(lines)

    launches = [i for i in range(start + 1, end) if lines[i].strip() == "# Launch chromium browser"]
    windows = [i for i in range(start + 1, end) if re.match(r"^\s*--window-size=.*\\\s*$", lines[i])]
    if len(launches) != 1 or len(windows) != 1:
        raise PatchError("expected one Chromium launch comment and --window-size in WEBUI_SHOW")

    launch = launches[0]
    indent = re.match(r"^(\s*)", lines[launch]).group(1)
    lines[launch:launch] = [
        indent + BEGIN,
        indent + f"SCALE_FACTOR={factor}",
        indent + 'WIDTH=$(( ${SCREEN_RES%,*} / SCALE_FACTOR ))',
        indent + 'HEIGHT=$(( ${SCREEN_RES#*,} / SCALE_FACTOR ))',
        indent + END,
    ]
    start, end = webui_bounds(lines)
    windows = [i for i in range(start + 1, end) if re.match(r"^\s*--window-size=.*\\\s*$", lines[i])]
    if len(windows) != 1:
        raise PatchError("expected one --window-size after inserting scaling block")
    window = windows[0]
    arg_indent = re.match(r"^(\s*)", lines[window]).group(1)
    lines[window] = arg_indent + '--window-size="${WIDTH},${HEIGHT}" \\'
    lines.insert(window + 1, arg_indent + '--force-device-scale-factor="$SCALE_FACTOR" \\')
    return nl.join(lines) + (nl if text.endswith(("\n", "\r\n")) else "")


def remove_scaling(text: str) -> str:
    nl = newline(text)
    lines = text.splitlines()
    begin = [i for i, line in enumerate(lines) if line.strip() == BEGIN]
    end_markers = [i for i, line in enumerate(lines) if line.strip() == END]
    if not begin and not end_markers:
        if any("--force-device-scale-factor=\"$SCALE_FACTOR\"" in line for line in lines):
            raise PatchError("managed arguments exist but the scaling markers are missing")
        return text
    if len(begin) != 1 or len(end_markers) != 1 or begin[0] >= end_markers[0]:
        raise PatchError("invalid managed scaling marker block")

    del lines[begin[0] : end_markers[0] + 1]
    start, end = webui_bounds(lines)
    windows = [
        i for i in range(start + 1, end)
        if re.match(r'^\s*--window-size="\$\{WIDTH\},\$\{HEIGHT\}"\s*\\\s*$', lines[i])
    ]
    factors = [
        i for i in range(start + 1, end)
        if re.match(r'^\s*--force-device-scale-factor="\$SCALE_FACTOR"\s*\\\s*$', lines[i])
    ]
    if len(windows) != 1 or len(factors) != 1:
        raise PatchError("managed Chromium scaling arguments are incomplete or changed")
    indent = re.match(r"^(\s*)", lines[windows[0]]).group(1)
    lines[windows[0]] = indent + '--window-size="$SCREEN_RES" \\'
    del lines[factors[0]]
    return nl.join(lines) + (nl if text.endswith(("\n", "\r\n")) else "")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("install", "uninstall"))
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("factor", nargs="?", type=int, default=2)
    args = parser.parse_args()
    text = args.input.read_text(encoding="utf-8")
    result = apply_scaling(text, args.factor) if args.mode == "install" else remove_scaling(text)
    args.output.write_text(result, encoding="utf-8", newline="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
