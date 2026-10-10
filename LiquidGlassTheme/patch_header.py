#!/usr/bin/env python3
"""Install or remove the Liquid Glass CSS/JavaScript includes in header.php."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


BEGIN = "<!-- BEGIN LIQUID GLASS THEME -->"
END = "<!-- END LIQUID GLASS THEME -->"
STYLESHEET = '<link rel="stylesheet" href="css/liquid-glass-theme.css?v=10">'
SCRIPT = '<script src="js/liquid-glass-theme.js?v=10" defer></script>'
PREVIOUS_BODIES = [
    [
        '<link rel="stylesheet" href="css/liquid-glass-theme.css">',
        '<script src="js/liquid-glass-theme.js" defer></script>',
    ],
    [
        '<link rel="stylesheet" href="css/liquid-glass-theme.css?v=2">',
        '<script src="js/liquid-glass-theme.js?v=2" defer></script>',
    ],
    [
        '<link rel="stylesheet" href="css/liquid-glass-theme.css?v=3">',
        '<script src="js/liquid-glass-theme.js?v=3" defer></script>',
    ],
    [
        '<link rel="stylesheet" href="css/liquid-glass-theme.css?v=4">',
        '<script src="js/liquid-glass-theme.js?v=4" defer></script>',
    ],
    [
        '<link rel="stylesheet" href="css/liquid-glass-theme.css?v=5">',
        '<script src="js/liquid-glass-theme.js?v=5" defer></script>',
    ],
    [
        '<link rel="stylesheet" href="css/liquid-glass-theme.css?v=6">',
        '<script src="js/liquid-glass-theme.js?v=6" defer></script>',
    ],
    [
        '<link rel="stylesheet" href="css/liquid-glass-theme.css?v=7">',
        '<script src="js/liquid-glass-theme.js?v=7" defer></script>',
    ],
    [
        '<link rel="stylesheet" href="css/liquid-glass-theme.css?v=8">',
        '<script src="js/liquid-glass-theme.js?v=8" defer></script>',
    ],
    [
        '<link rel="stylesheet" href="css/liquid-glass-theme.css?v=9">',
        '<script src="js/liquid-glass-theme.js?v=9" defer></script>',
    ],
]
SOURCE_ANCHOR = re.compile(r'^\s*<script src="js/scripts-panels\.js(?:\?[^\"]*)?" defer></script>\s*$')
BUILT_ANCHOR = re.compile(r'^\s*<script src="js/main\.min\.js(?:\?[^\"]*)?" defer></script>\s*$')


def apply(text: str) -> str:
    if BEGIN in text or END in text:
        lines = text.splitlines(keepends=True)
        starts = [i for i, line in enumerate(lines) if line.strip() == BEGIN]
        ends = [i for i, line in enumerate(lines) if line.strip() == END]
        if len(starts) != 1 or len(ends) != 1 or starts[0] >= ends[0]:
            raise ValueError("invalid Liquid Glass marker block in header.php")
        body = [line.strip() for line in lines[starts[0] + 1:ends[0]] if line.strip()]
        if body == [STYLESHEET, SCRIPT]:
            return text
        if body not in PREVIOUS_BODIES:
            raise ValueError("managed Liquid Glass block was changed; refusing to upgrade it")
        indent = re.match(r"^(\s*)", lines[starts[0]]).group(1)
        newline = "\r\n" if "\r\n" in text else "\n"
        lines[starts[0] + 1:ends[0]] = [
            indent + STYLESHEET + newline,
            indent + SCRIPT + newline,
        ]
        return "".join(lines)

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
    lines[anchor + 1:anchor + 1] = [
        indent + BEGIN,
        indent + STYLESHEET,
        indent + SCRIPT,
        indent + END,
    ]
    return nl.join(lines) + (nl if text.endswith(("\n", "\r\n")) else "")


def remove(text: str) -> str:
    if BEGIN not in text and END not in text:
        return text
    lines = text.splitlines(keepends=True)
    starts = [i for i, line in enumerate(lines) if line.strip() == BEGIN]
    ends = [i for i, line in enumerate(lines) if line.strip() == END]
    if len(starts) != 1 or len(ends) != 1 or starts[0] >= ends[0]:
        raise ValueError("invalid Liquid Glass marker block in header.php")
    body = [line.strip() for line in lines[starts[0] + 1:ends[0]] if line.strip()]
    if body != [STYLESHEET, SCRIPT] and body not in PREVIOUS_BODIES:
        raise ValueError("managed Liquid Glass block was changed; refusing to remove it")
    del lines[starts[0]:ends[0] + 1]
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
