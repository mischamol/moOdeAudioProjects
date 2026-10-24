#!/usr/bin/env python3
import unittest

import patch_header


SOURCE_HEADER = """<script src="js/playerlib.js" defer></script>
\t<script src="js/scripts-panels.js" defer></script>
"""

BUILT_HEADER = """<script src="js/lib.min.js?t=123" defer></script>
\t<script src="js/main.min.js?t=123" defer></script>
"""


class HeaderPatchTests(unittest.TestCase):
    def test_source_install_is_idempotent_and_round_trips(self):
        installed = patch_header.apply(SOURCE_HEADER)
        self.assertIn(patch_header.STYLESHEET, installed)
        self.assertIn(patch_header.SCRIPT, installed)
        self.assertEqual(patch_header.apply(installed), installed)
        self.assertEqual(patch_header.remove(installed), SOURCE_HEADER)

    def test_release_header_round_trips(self):
        installed = patch_header.apply(BUILT_HEADER)
        self.assertEqual(patch_header.remove(installed), BUILT_HEADER)

    def test_previous_blocks_are_upgraded_and_remain_removable(self):
        for previous_body in patch_header.PREVIOUS_BODIES:
            with self.subTest(previous_body=previous_body):
                previous = patch_header.apply(SOURCE_HEADER)
                previous = previous.replace(patch_header.STYLESHEET, previous_body[0])
                previous = previous.replace(patch_header.SCRIPT, previous_body[1])
                upgraded = patch_header.apply(previous)
                self.assertIn(patch_header.STYLESHEET, upgraded)
                self.assertIn(patch_header.SCRIPT, upgraded)
                self.assertEqual(patch_header.remove(upgraded), SOURCE_HEADER)

    def test_unknown_layout_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "expected one"):
            patch_header.apply("<html></html>\n")

    def test_changed_managed_block_is_not_removed(self):
        installed = patch_header.apply(SOURCE_HEADER).replace(
            patch_header.SCRIPT, '<script src="js/changed.js"></script>',
        )
        with self.assertRaisesRegex(ValueError, "changed"):
            patch_header.remove(installed)


if __name__ == "__main__":
    unittest.main()
