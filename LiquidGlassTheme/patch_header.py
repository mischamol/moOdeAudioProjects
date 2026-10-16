#!/usr/bin/env python3
"""Install or remove the Liquid Glass CSS/JavaScript includes in header.php."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


BEGIN = "<!-- BEGIN LIQUID GLASS THEME -->"
END = "<!-- END LIQUID GLASS THEME -->"
ASSET_VERSION = 52
SOURCE_ANCHOR = re.compile(
    r'^\s*<script src="js/scripts-panels\.js(?:\?[^\"]*)?" defer></script>\s*$'
)
BUILT_ANCHOR = re.compile(
    r'^\s*<script src="js/main\.min\.js(?:\?[^\"]*)?" defer></script>\s*$'
)


def asset_body(version: int) -> list[str]:
    suffix = "" if version == 1 else f"?v={version}"
    return [
        f'<link rel="stylesheet" href="css/liquid-glass-theme.css{suffix}">',
        f'<script src="js/liquid-glass-theme.js{suffix}" defer></script>',
    ]


CURRENT_BODY = asset_body(ASSET_VERSION)
PREVIOUS_BODIES = [asset_body(version) for version in range(1, ASSET_VERSION)]
STYLESHEET, SCRIPT = CURRENT_BODY


def managed_block(lines: list[str]) -> tuple[int, int, list[str]]:
    starts = [i for i, line in enumerate(lines) if line.strip() == BEGIN]
    ends = [i for i, line in enumerate(lines) if line.strip() == END]
    if len(starts) != 1 or len(ends) != 1 or starts[0] >= ends[0]:
        raise ValueError("invalid Liquid Glass marker block in header.php")
    start, end = starts[0], ends[0]
    body = [line.strip() for line in lines[start + 1:end] if line.strip()]
    return start, end, body


def apply(text: str) -> str:
    if BEGIN in text or END in text:
        lines = text.splitlines(keepends=True)
        start, end, body = managed_block(lines)
        if body == CURRENT_BODY:
            return text
        if body not in PREVIOUS_BODIES:
            raise ValueError("managed Liquid Glass block was changed; refusing to upgrade it")
        indent = re.match(r"^(\s*)", lines[start]).group(1)
        newline = "\r\n" if "\r\n" in text else "\n"
        lines[start + 1:end] = [
            indent + STYLESHEET + newline,
            indent + SCRIPT + newline,
        ]
        return "".join(lines)

    newline = "\r\n" if "\r\n" in text else "\n"
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
        *(indent + line for line in CURRENT_BODY),
        indent + END,
    ]
    return newline.join(lines) + (newline if text.endswith(("\n", "\r\n")) else "")


def remove(text: str) -> str:
    if BEGIN not in text and END not in text:
        return text
    lines = text.splitlines(keepends=True)
    start, end, body = managed_block(lines)
    if body != CURRENT_BODY and body not in PREVIOUS_BODIES:
        raise ValueError("managed Liquid Glass block was changed; refusing to remove it")
    del lines[start:end + 1]
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
