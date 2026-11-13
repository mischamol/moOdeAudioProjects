#!/usr/bin/env python3
"""Install or remove the Apple Music script include in moOde's header.php.

The script is included twice: on the Playback/Library page (after
main.min.js) for the Library menu entry and the renderer screen, and on the
configuration pages (after config.min.js) for the Apple Music Webplayer block
on Configure > Renderers."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

BEGIN = "<!-- BEGIN APPLE MUSIC -->"
END = "<!-- END APPLE MUSIC -->"
ASSET_VERSION = 9
BODY = [f'<script src="js/applemusic.js?v={ASSET_VERSION}" defer></script>']
ANCHOR = re.compile(r'^\s*<script src="js/(?:main\.min|scripts-panels)\.js(?:\?[^"]*)?" defer></script>\s*$')
CONFIG_ANCHOR = re.compile(r'^\s*<script src="js/(?:config\.min|scripts-configs)\.js(?:\?[^"]*)?" defer></script>\s*$')
BLOCK = re.compile(r"^[ \t]*" + re.escape(BEGIN) + r".*?" + re.escape(END) + r"[ \t]*\r?\n?", re.S | re.M)


def install(text: str) -> str:
    text = BLOCK.sub("", text)
    newline = "\r\n" if "\r\n" in text else "\n"
    lines = text.split(newline)
    anchors = [i for i, line in enumerate(lines) if ANCHOR.match(line)]
    if len(anchors) != 1:
        raise SystemExit(f"expected one main.min.js/scripts-panels.js include, found {len(anchors)}")
    # The configuration pages' include is optional (older moOde versions).
    config = [i for i, line in enumerate(lines) if CONFIG_ANCHOR.match(line)]
    targets = anchors + (config[:1] if len(config) == 1 else [])
    for at in sorted(targets, reverse=True):
        indent = re.match(r"^(\s*)", lines[at]).group(1)
        lines[at + 1:at + 1] = [indent + BEGIN, *(indent + b for b in BODY), indent + END]
    return newline.join(lines)


def uninstall(text: str) -> str:
    return BLOCK.sub("", text)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("action", choices=["install", "uninstall"])
    p.add_argument("source", type=Path)
    p.add_argument("target", type=Path)
    a = p.parse_args()
    text = a.source.read_text(encoding="utf-8")
    a.target.write_text(install(text) if a.action == "install" else uninstall(text), encoding="utf-8")


if __name__ == "__main__":
    main()
