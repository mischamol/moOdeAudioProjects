#!/usr/bin/env python3
import importlib.util
import pathlib
import tempfile
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name("moode_startup_shutdown_screen.py")
SPEC = importlib.util.spec_from_file_location("startup_shutdown", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class ProgressTests(unittest.TestCase):
    def test_smoothstep_is_clamped(self):
        self.assertEqual(MODULE.smoothstep(-1), 0)
        self.assertEqual(MODULE.smoothstep(0), 0)
        self.assertEqual(MODULE.smoothstep(1), 1)
        self.assertEqual(MODULE.smoothstep(2), 1)

    def test_smoothstep_midpoint(self):
        self.assertAlmostEqual(MODULE.smoothstep(0.5), 0.5)
        self.assertLess(MODULE.smoothstep(0.25), 0.25)
        self.assertGreater(MODULE.smoothstep(0.75), 0.75)

    def test_shutdown_only_during_real_system_stop(self):
        self.assertTrue(MODULE.should_show_shutdown("stopping\n"))
        for state in ("running", "degraded", "maintenance", ""):
            with self.subTest(state=state):
                self.assertFalse(MODULE.should_show_shutdown(state))

    def test_rgb565_is_little_endian(self):
        self.assertEqual(MODULE.rgb565(255, 0, 0), b"\x00\xf8")
        self.assertEqual(MODULE.rgb565(0, 255, 0), b"\xe0\x07")
        self.assertEqual(MODULE.rgb565(0, 0, 255), b"\x1f\x00")

    def test_geometry_reads_framebuffer_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / "virtual_size").write_text("720,1280\n")
            (root / "stride").write_text("1440\n")
            (root / "bits_per_pixel").write_text("16\n")
            geometry = MODULE.Geometry.from_sysfs(root)
            self.assertEqual((geometry.width, geometry.height), (720, 1280))
            self.assertEqual(geometry.stride, 1440)

    def test_geometry_rejects_non_rgb565_framebuffer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / "virtual_size").write_text("720,1280\n")
            (root / "stride").write_text("2880\n")
            (root / "bits_per_pixel").write_text("32\n")
            with self.assertRaisesRegex(RuntimeError, "16 bpp"):
                MODULE.Geometry.from_sysfs(root)


if __name__ == "__main__":
    unittest.main()
