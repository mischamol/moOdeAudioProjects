#!/usr/bin/env python3
import unittest

import patch_header


HEADER = """<script src=\"js/playerlib.js\" defer></script>
\t<script src=\"js/scripts-library.js\" defer></script>
\t<script src=\"js/scripts-panels.js\" defer></script>
\t<script src=\"js/radio-browser.js\" defer></script>
"""

BUILT_HEADER = """<script src=\"js/lib.min.js?t=123\" defer></script>
\t<script src=\"js/main.min.js?t=123\" defer></script>
"""


class HeaderPatchTests(unittest.TestCase):
    def test_install_is_idempotent_and_uninstall_round_trips(self):
        installed = patch_header.apply(HEADER)
        self.assertIn(patch_header.BEGIN, installed)
        self.assertIn(patch_header.SCRIPT, installed)
        self.assertEqual(patch_header.apply(installed), installed)
        self.assertEqual(patch_header.remove(installed), HEADER)

    def test_unknown_layout_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "expected one"):
            patch_header.apply("<html></html>\n")

    def test_release_minified_header_round_trips(self):
        installed = patch_header.apply(BUILT_HEADER)
        self.assertIn(patch_header.SCRIPT, installed)
        self.assertEqual(patch_header.remove(installed), BUILT_HEADER)

    def test_changed_managed_block_is_not_removed(self):
        installed = patch_header.apply(HEADER).replace(
            patch_header.SCRIPT, '<script src="js/changed.js"></script>',
        )
        with self.assertRaisesRegex(ValueError, "changed"):
            patch_header.remove(installed)


if __name__ == "__main__":
    unittest.main()
