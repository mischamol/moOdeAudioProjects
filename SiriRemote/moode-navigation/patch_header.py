#!/usr/bin/env python3
"""Install or remove the Siri Remote navigation script include in header.php."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


BEGIN = "<!-- BEGIN SIRI REMOTE LIBRARY NAVIGATION -->"
END = "<!-- END SIRI REMOTE LIBRARY NAVIGATION -->"
SCRIPT = '<script src="js/siri-remote-navigation.js" defer></script>'
SOURCE_ANCHOR = re.compile(r'^\s*<script src="js/scripts-panels\.js(?:\?[^\"]*)?" defer></script>\s*$')
BUILT_ANCHOR = re.compile(r'^\s*<script src="js/main\.min\.js(?:\?[^\"]*)?" defer></script>\s*$')


def apply(text: str) -> str:
    if BEGIN in text or END in text:
        if text.count(BEGIN) == text.count(END) == text.count(SCRIPT) == 1:
            return text
        raise ValueError("invalid Siri Remote navigation marker block in header.php")
    nl = "\r\n" if "\r\n" in text else "\n"
    lines = text.splitlines()
    source = [i for i, line in enumerate(lines) if SOURCE_ANCHOR.match(line)]
    built = [i for i, line in enumerate(lines) if BUILT_ANCHOR.match(line)]
    anchors = source if source else built
    if len(anchors) != 1:
        raise ValueError(
            "expected one scripts-panels.js or main.min.js include, "
            f"found source={len(source)}, built={len(built)}"
        )
    anchor = anchors[0]
    indent = re.match(r"^(\s*)", lines[anchor]).group(1)
    lines[anchor + 1 : anchor + 1] = [
        indent + BEGIN,
        indent + SCRIPT,
        indent + END,
    ]
    return nl.join(lines) + (nl if text.endswith(("\n", "\r\n")) else "")


def remove(text: str) -> str:
    if BEGIN not in text and END not in text:
        return text
    block = BEGIN + "\n"
    # Preserve the indentation used by the surrounding moOde script includes.
    lines = text.splitlines(keepends=True)
    starts = [i for i, line in enumerate(lines) if line.strip() == BEGIN]
    ends = [i for i, line in enumerate(lines) if line.strip() == END]
    if len(starts) != 1 or len(ends) != 1 or starts[0] >= ends[0]:
        raise ValueError("invalid Siri Remote navigation marker block in header.php")
    body = [line.strip() for line in lines[starts[0] + 1 : ends[0]] if line.strip()]
    if body != [SCRIPT]:
        raise ValueError("managed navigation include was changed; refusing to remove it")
    del lines[starts[0] : ends[0] + 1]
    return "".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("install", "uninstall"))
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    text = args.input.read_text(encoding="utf-8")
    result = apply(text) if args.mode == "install" else remove(text)
    args.output.write_text(result, encoding="utf-8", newline="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
