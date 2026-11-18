#!/usr/bin/env python3
import os
import sqlite3
import struct
import tempfile
import unittest
from unittest import mock

import siri_remote_moode as remote


class FakeWorker:
    def __init__(self):
        self.actions = []

    def submit(self, name, command):
        self.actions.append((name, command))


class FakeClicker:
    def __init__(self):
        self.clicks = 0
        self.library_menus = 0
        self.navigation_enabled = True
        self.navigation_actions = []

    def submit(self):
        self.clicks += 1

    def submit_navigation(self, action):
        self.navigation_actions.append(action)

    def submit_library_menu(self):
        self.library_menus += 1


class FakeOverlayWorker:
    def __init__(self):
        self.submissions = []
        self.sequences = []
        self.countdowns = []
        self.cancellations = []
        self.enabled = True

    def submit(self, text, duration=None, kind="command"):
        self.submissions.append((text, duration, kind))

    def submit_sequence(self, frames, kind="command"):
        self.sequences.append((frames, kind))

    def start_shutdown(self, seconds):
        self.countdowns.append(seconds)

    def cancel(self, kind=None):
        self.cancellations.append(kind)

class FakeRendererGuard:
    def __init__(self, allowed):
        self.allowed = allowed
        self.actions = []

    def allows(self, action_name):
        self.actions.append(action_name)
        return self.allowed


def touch_report(x, buttons=0, pressure=40, y=3800):
    payload = bytearray(13)
    payload[0] = 1
    payload[1] = buttons
    payload[2] = remote.TOUCH_EVENT_MARKER
    raw_x = x & 0x0FFF
    payload[6] = raw_x & 0xFF
    payload[7] = (raw_x >> 8) & 0x0F
    raw_y = y & 0x0FFF
    payload[7] |= (raw_y & 0x0F) << 4
    payload[8] = (raw_y >> 4) & 0xFF
    payload[10] = pressure
    payload[11] = pressure
    return bytes(payload)


class ButtonMapperTests(unittest.TestCase):
    def setUp(self):
        env = {
            "SIRI_TOUCH_X_SPLIT": "3096",
            "SIRI_TOUCH_DEAD_ZONE": "60",
            "SIRI_TOUCH_MAX_AGE_SECONDS": "1.5",
            "SIRI_SWIPE_MIN_DISTANCE": "300",
            "SIRI_SWIPE_STEP_DISTANCE": "380",
            "SIRI_SWIPE_Y_SCALE": "1.0",
            "SIRI_SWIPE_MAX_STEPS": "8",
            "SIRI_SWIPE_MOMENTUM_MIN_SPEED": "5000",
            "SIRI_SWIPE_MOMENTUM_SECONDS": "0.13",
            "SIRI_SWIPE_MOMENTUM_MAX_DISTANCE": "1900",
            "SIRI_TOUCH_SEQUENCE_GAP_SECONDS": "0.35",
            "SIRI_RECONNECT_DUPLICATE_GUARD_SECONDS": "2",
            "MOODE_PREVIOUS_CMD": "previous",
            "MOODE_NEXT_CMD": "next",
        }
        self.env = mock.patch.dict(os.environ, env, clear=False)
        self.env.start()
        self.worker = FakeWorker()
        self.mapper = remote.ButtonMapper(self.worker, shutdown_action=lambda: None)

    def tearDown(self):
        self.mapper.reset()
        self.env.stop()

    def notify(self, payload):
        self.mapper.notification(remote.HANDLE_INPUT_VALUE, payload)

    def test_touch_decode_uses_gen1_wrapped_12_bit_range(self):
        self.assertEqual(self.mapper.decode_touch_x(touch_report(2500)), 2500)
        # A raw value below 0x800 wraps into the upper 12-bit range.
        self.assertEqual(self.mapper.decode_touch_x(touch_report(0x020)), 0x1020)

    def test_touch_decode_includes_y_and_pressure(self):
        self.assertEqual(
            self.mapper.decode_touch(touch_report(2500, pressure=44, y=4200)),
            (2500, 4200, 44),
        )

    def test_left_position_followed_by_click_is_previous_once(self):
        self.notify(touch_report(2500))
        self.notify(bytes((0, remote.BUTTON_TOUCHPAD)))
        self.notify(bytes((0, remote.BUTTON_TOUCHPAD)))
        self.assertEqual(
            self.worker.actions,
            [("Touchpad left / Previous", "previous")],
        )

    def test_right_click_report_is_next_once(self):
        self.notify(touch_report(3600, remote.BUTTON_TOUCHPAD))
        self.notify(touch_report(3700, remote.BUTTON_TOUCHPAD))
        self.assertEqual(
            self.worker.actions,
            [("Touchpad right / Next", "next")],
        )

    def test_click_can_arrive_before_its_touch_position(self):
        self.notify(bytes((0, remote.BUTTON_TOUCHPAD)))
        self.assertEqual(self.worker.actions, [])
        self.notify(touch_report(2500, remote.BUTTON_TOUCHPAD))
        self.assertEqual(
            self.worker.actions,
            [("Touchpad left / Previous", "previous")],
        )

    def test_release_allows_the_next_click(self):
        self.notify(touch_report(2500, remote.BUTTON_TOUCHPAD))
        self.notify(bytes((0, 0)))
        self.notify(touch_report(3600, remote.BUTTON_TOUCHPAD))
        self.assertEqual([action[1] for action in self.worker.actions], ["previous", "next"])

    def test_center_dead_zone_is_ignored(self):
        self.notify(touch_report(3096, remote.BUTTON_TOUCHPAD))
        self.notify(touch_report(2500, remote.BUTTON_TOUCHPAD))
        self.assertEqual(self.worker.actions, [])

    def test_touch_without_physical_click_does_nothing(self):
        self.notify(touch_report(2500))
        self.notify(touch_report(3600))
        self.assertEqual(self.worker.actions, [])

    def gesture(self, samples, timers=None, apple_music=False):
        """Feed (time, x, y[, pressure]) touch samples to a navigation mapper."""
        clicker = FakeClicker()
        if apple_music:
            clicker.apple_music = mock.Mock(visible=mock.Mock(return_value=True))
        fake_timers = [] if timers is None else timers

        class FakeTimer:
            def __init__(self, delay, function, args=()):
                self.delay, self.function, self.args = delay, function, args
                self.cancelled = False
                self.daemon = False

            def start(self):
                fake_timers.append(self)

            def cancel(self):
                self.cancelled = True

        mapper = remote.ButtonMapper(
            self.worker, shutdown_action=lambda: None, screen_clicker=clicker,
        )
        times = [sample[0] for sample in samples]
        # Coasting steps schedule the next step from inside a timer, so the
        # fake timer stays in place until the test ends.
        timer_patch = mock.patch.object(remote.threading, "Timer", FakeTimer)
        timer_patch.start()
        self.addCleanup(timer_patch.stop)
        with mock.patch.object(remote.time, "monotonic", side_effect=times):
            for sample in samples:
                t, x, y = sample[:3]
                pressure = sample[3] if len(sample) > 3 else 40
                mapper.notification(
                    remote.HANDLE_INPUT_VALUE, touch_report(x, y=y, pressure=pressure),
                )
        return mapper, clicker, fake_timers

    @staticmethod
    def run_timers(timers):
        while timers:
            timer = timers.pop(0)
            if not timer.cancelled:
                timer.function(*timer.args)

    def test_thumb_travel_sets_the_number_of_steps(self):
        mapper, clicker, _ = self.gesture([
            (100.0, 2500, 3500), (100.19, 3000, 3520),
            (101.0, 3000, 3400), (101.19, 3020, 4300),
        ])
        # 500 units right: one step. 900 units up: 300 + 380 = two.
        self.assertEqual(
            clicker.navigation_actions,
            ["right", "up", "continue-up"],
        )
        mapper.reset()

    def test_stale_button_while_connecting_is_ignored(self):
        clicker = FakeClicker()
        mapper = remote.ButtonMapper(
            self.worker, shutdown_action=lambda: None, screen_clicker=clicker,
        )
        mapper.mark_connecting()
        # Seen after waking by a swipe: Menu, reported before input was active.
        mapper.notification(remote.HANDLE_INPUT_VALUE, bytes((0, remote.BUTTON_MENU)))
        mapper.mark_connection_ready()
        mapper.notification(remote.HANDLE_INPUT_VALUE, bytes((0, 0)))
        self.assertEqual(clicker.clicks, 0)
        self.assertEqual(self.worker.actions, [])
        # A real Volume+ afterwards still counts.
        mapper.notification(remote.HANDLE_INPUT_VALUE, bytes((0, remote.BUTTON_VOLUME_UP)))
        self.assertEqual(len(self.worker.actions), 1)
        mapper.reset()

    def test_vertical_travel_is_scaled(self):
        with mock.patch.dict(os.environ, {"SIRI_SWIPE_Y_SCALE": "2.0"}):
            mapper, clicker, _ = self.gesture([
                (105.0, 3000, 3400), (105.19, 3000, 3900),
            ])
        # 500 units up count as 1000: 300 + 380 = two steps.
        self.assertEqual(clicker.navigation_actions, ["up", "continue-up"])
        mapper.reset()

    def test_direction_can_change_during_a_swipe(self):
        mapper, clicker, _ = self.gesture([
            (110.0, 2500, 3800), (110.2, 3000, 3800), (110.4, 3000, 3300),
        ])
        self.assertEqual(
            clicker.navigation_actions,
            # After the first step every step is 380 units: 500 down is one.
            ["right", "down"],
        )
        mapper.reset()

    def test_slow_swipe_has_no_time_limit(self):
        samples = [(120.0 + i * 0.3, 2300 + i * 150, 3800) for i in range(11)]
        mapper, clicker, timers = self.gesture(samples + [(123.3, 3800, 3800, 0)])
        # 1500 units: the first step at 300, then one per 380.
        self.assertEqual(
            clicker.navigation_actions,
            ["right"] + ["continue-right"] * 3,
        )
        self.assertEqual(timers, [])
        mapper.reset()

    def test_flick_coasts_on_after_release(self):
        timers = []
        mapper, clicker, _ = self.gesture([
            (130.0, 2600, 3800), (130.02, 2700, 3800), (130.05, 3300, 3800),
            (130.09, 3700, 3800), (130.12, 3700, 3800, 0),
        ], timers)
        self.assertEqual(
            clicker.navigation_actions, ["right"] + ["continue-right"] * 2,
        )
        delays = []
        while timers:
            timer = timers.pop(0)
            delays.append(timer.delay)
            timer.function(*timer.args)
        # About 14300 units/s: (14300 - 5000) x 0.13 = 1200 units, three steps.
        self.assertEqual(
            clicker.navigation_actions, ["right"] + ["continue-right"] * 5,
        )
        # Each coasting step comes later than the one before: it slows down.
        self.assertTrue(all(b > a for a, b in zip(delays, delays[1:])))
        mapper.reset()

    def test_apple_music_swipe_moves_one_row_and_does_not_coast(self):
        timers = []
        mapper, clicker, _ = self.gesture([
            (160.0, 3000, 4300), (160.1, 3000, 3300), (160.15, 3000, 3000),
            (160.2, 3000, 3000, 0),
        ], timers, apple_music=True)
        # 1300 units down would be four rows in moOde; Apple Music gets one.
        self.assertEqual(clicker.navigation_actions, ["down"])
        self.assertEqual(timers, [])
        mapper.reset()

    def test_apple_music_horizontal_swipe_is_unlimited(self):
        mapper, clicker, _ = self.gesture([
            (170.0, 2300, 3800), (170.3, 2800, 3800), (170.6, 3400, 3800),
            (170.9, 3900, 3800),
        ], apple_music=True)
        self.assertEqual(clicker.navigation_actions, ["right"] + ["continue-right"] * 3)
        mapper.reset()

    def test_thumb_that_stops_before_lifting_does_not_coast(self):
        mapper, clicker, timers = self.gesture([
            (140.0, 2600, 3800), (140.05, 3300, 3800), (140.2, 3320, 3800),
            (140.3, 3320, 3800), (140.45, 3320, 3800, 0),
        ])
        self.assertEqual(clicker.navigation_actions, ["right", "continue-right"])
        self.assertEqual(timers, [])
        mapper.reset()

    def test_new_touch_stops_coasting(self):
        timers = []
        mapper, clicker, _ = self.gesture([
            (150.0, 2600, 3800), (150.05, 3300, 3800), (150.09, 3700, 3800),
            (150.12, 3700, 3800, 0), (150.2, 3000, 3800),
        ], timers)
        before = list(clicker.navigation_actions)
        self.run_timers(timers)
        self.assertEqual(clicker.navigation_actions, before)
        mapper.reset()

    def test_physical_click_routes_to_selection_when_navigation_is_enabled(self):
        clicker = FakeClicker()
        mapper = remote.ButtonMapper(
            self.worker, shutdown_action=lambda: None, screen_clicker=clicker,
        )
        mapper.notification(
            remote.HANDLE_INPUT_VALUE,
            touch_report(2500, remote.BUTTON_TOUCHPAD),
        )
        mapper.notification(remote.HANDLE_INPUT_VALUE, bytes((0, 0)))
        mapper.notification(
            remote.HANDLE_INPUT_VALUE,
            touch_report(3096, remote.BUTTON_TOUCHPAD),
        )
        self.assertEqual(
            clicker.navigation_actions,
            ["select-left", "select"],
        )
        self.assertEqual(self.worker.actions, [])
        mapper.reset()

    def test_play_pause_still_works_after_each_release(self):
        for _ in range(2):
            self.notify(bytes((0, remote.BUTTON_PLAY_PAUSE)))
            self.notify(bytes((0, 0)))
        self.assertEqual(
            [action[1] for action in self.worker.actions],
            ["toggle_play_pause", "toggle_play_pause"],
        )

    def test_repeated_volume_press_recovers_when_release_is_missing(self):
        with mock.patch.object(
            remote.time, "monotonic", side_effect=(100.0, 100.3, 100.8),
        ):
            self.notify(bytes((0, remote.BUTTON_VOLUME_DOWN)))
            self.notify(bytes((0, remote.BUTTON_VOLUME_DOWN)))
            self.notify(bytes((0, remote.BUTTON_VOLUME_DOWN)))
        self.assertEqual(
            self.worker.actions,
            [
                ("Volume -", "set_volume -dn 5"),
                ("Volume -", "set_volume -dn 5"),
            ],
        )

    def test_reconnect_duplicate_volume_report_is_not_a_second_click(self):
        with mock.patch.object(
            remote.time, "monotonic", side_effect=(100.0, 100.2, 101.2),
        ):
            self.notify(bytes((0, remote.BUTTON_VOLUME_UP)))
            self.mapper.mark_connection_ready()
            self.notify(bytes((0xE0, remote.BUTTON_VOLUME_UP, 0)))
        self.assertEqual(
            self.worker.actions,
            [("Volume +", "set_volume -up 5")],
        )

    def test_real_volume_clicks_with_releases_work_during_reconnect_guard(self):
        with mock.patch.object(
            remote.time,
            "monotonic",
            side_effect=(100.0, 100.1, 100.2, 100.3, 100.4),
        ):
            self.mapper.mark_connection_ready()
            self.notify(bytes((0, remote.BUTTON_VOLUME_UP)))
            self.notify(bytes((0, 0)))
            self.notify(bytes((0, remote.BUTTON_VOLUME_UP)))
            self.notify(bytes((0, 0)))
        self.assertEqual(
            self.worker.actions,
            [
                ("Volume +", "set_volume -up 5"),
                ("Volume +", "set_volume -up 5"),
            ],
        )

    def test_repeated_play_pause_without_release_is_not_recovered(self):
        with mock.patch.object(
            remote.time, "monotonic", side_effect=(100.0, 101.0),
        ):
            self.notify(bytes((0, remote.BUTTON_PLAY_PAUSE)))
            self.notify(bytes((0, remote.BUTTON_PLAY_PAUSE)))
        self.assertEqual(
            self.worker.actions,
            [("Play/Pause", "toggle_play_pause")],
        )

    def test_single_menu_click_is_submitted_after_double_click_window(self):
        clicker = FakeClicker()
        mapper = remote.ButtonMapper(
            self.worker,
            shutdown_action=lambda: None,
            screen_clicker=clicker,
        )
        timer = mock.Mock()
        with mock.patch.object(remote.threading, "Timer", return_value=timer) as make:
            mapper.notification(
                remote.HANDLE_INPUT_VALUE,
                bytes((0, remote.BUTTON_MENU)),
            )
            self.assertEqual(clicker.clicks, 0)
            timer.start.assert_called_once_with()
            make.call_args.args[1]()
        self.assertEqual(clicker.clicks, 1)
        self.assertEqual(clicker.library_menus, 0)
        self.assertEqual(self.worker.actions, [])
        mapper.reset()

    def test_double_menu_click_opens_library_source_menu(self):
        clicker = FakeClicker()
        mapper = remote.ButtonMapper(
            self.worker,
            shutdown_action=lambda: None,
            screen_clicker=clicker,
        )
        timer = mock.Mock()
        with mock.patch.object(remote.threading, "Timer", return_value=timer):
            mapper.notification(
                remote.HANDLE_INPUT_VALUE,
                bytes((0, remote.BUTTON_MENU)),
            )
            mapper.notification(remote.HANDLE_INPUT_VALUE, bytes((0, 0)))
            mapper.notification(
                remote.HANDLE_INPUT_VALUE,
                bytes((0, remote.BUTTON_MENU)),
            )
        timer.cancel.assert_called_once_with()
        self.assertEqual(clicker.clicks, 0)
        self.assertEqual(clicker.library_menus, 1)
        mapper.reset()

    def test_touch_navigation_waits_for_success_before_overlay(self):
        overlay = FakeOverlayWorker()
        mapper = remote.ButtonMapper(
            self.worker,
            shutdown_action=lambda: None,
            overlay_worker=overlay,
        )
        mapper.notification(
            remote.HANDLE_INPUT_VALUE,
            touch_report(2500, remote.BUTTON_TOUCHPAD),
        )
        mapper.notification(remote.HANDLE_INPUT_VALUE, bytes((0, 0)))
        mapper.notification(
            remote.HANDLE_INPUT_VALUE,
            touch_report(3600, remote.BUTTON_TOUCHPAD),
        )
        self.assertEqual(overlay.submissions, [])
        mapper.reset()

    def test_home_starts_and_release_cancels_shutdown_overlay(self):
        overlay = FakeOverlayWorker()
        mapper = remote.ButtonMapper(
            self.worker,
            shutdown_action=lambda: None,
            overlay_worker=overlay,
        )
        mapper.notification(
            remote.HANDLE_INPUT_VALUE,
            bytes((0, mapper.home_mask)),
        )
        mapper.notification(remote.HANDLE_INPUT_VALUE, bytes((0, 0)))
        self.assertEqual(overlay.countdowns, [3.0])
        self.assertIn("shutdown", overlay.cancellations)
        mapper.reset()

    def test_microphone_button_shows_cached_battery_once_per_press(self):
        battery_requests = []
        mapper = remote.ButtonMapper(
            self.worker,
            shutdown_action=lambda: None,
            battery_display_action=lambda: battery_requests.append(True),
        )
        mapper.notification(
            remote.HANDLE_INPUT_VALUE,
            bytes((0, remote.BUTTON_SIRI)),
        )
        mapper.notification(
            remote.HANDLE_INPUT_VALUE,
            bytes((0, remote.BUTTON_SIRI)),
        )
        mapper.notification(remote.HANDLE_INPUT_VALUE, bytes((0, 0)))
        mapper.notification(
            remote.HANDLE_INPUT_VALUE,
            bytes((0, remote.BUTTON_SIRI)),
        )
        self.assertEqual(self.worker.actions, [])
        self.assertEqual(battery_requests, [True, True])
        mapper.reset()


class RendererGuardTests(unittest.TestCase):
    def test_active_renderers_recognizes_all_enabled_flags(self):
        data = {flag: "0" for flag in remote.RendererGuard.ACTIVE_FLAGS}
        data.update({"aplactive": "1", "spotactive": 1, "rxactive": "1"})
        self.assertEqual(
            remote.RendererGuard.active_renderers(data),
            ("aplactive", "spotactive", "rxactive"),
        )

    def test_active_renderers_rejects_invalid_response(self):
        with self.assertRaisesRegex(ValueError, "invalid"):
            remote.RendererGuard.active_renderers([])

    def test_active_renderer_blocks_action_and_status_failure_fails_closed(self):
        blocked = []
        guard = remote.RendererGuard(
            "http://localhost/command/", 4, blocked_handler=blocked.append,
        )
        with mock.patch.object(guard, "check", return_value=("aplactive",)):
            self.assertFalse(guard.allows("Play/Pause"))
        with mock.patch.object(guard, "check", return_value=None):
            self.assertFalse(guard.allows("Volume +"))
        self.assertEqual(blocked, ["AirPlay", "Renderer"])

    def test_every_renderer_flag_has_a_display_name(self):
        self.assertEqual(set(remote.RendererGuard.ACTIVE_FLAGS), set(remote.RENDERER_NAMES))
        self.assertEqual(remote.RENDERER_NAMES["rxactive"], "Multiroom Receiver")

    def test_no_active_renderer_allows_action(self):
        blocked = []
        guard = remote.RendererGuard(
            "http://localhost/command/", 4, blocked_handler=blocked.append,
        )
        with mock.patch.object(guard, "check", return_value=()):
            self.assertTrue(guard.allows("Play/Pause"))
        self.assertEqual(blocked, [])

    def test_direct_database_read_returns_active_renderers(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "moode.db")
            connection = sqlite3.connect(path)
            try:
                connection.execute(
                    "CREATE TABLE cfg_system "
                    "(id INTEGER PRIMARY KEY, param CHAR(32), value CHAR(32))"
                )
                connection.executemany(
                    "INSERT INTO cfg_system (param, value) VALUES (?, ?)",
                    [
                        (flag, "1" if flag in ("aplactive", "spotactive") else "0")
                        for flag in remote.RendererGuard.ACTIVE_FLAGS
                    ],
                )
                connection.commit()
            finally:
                connection.close()
            with mock.patch.dict(
                os.environ, {"MOODE_DB_PATH": path}, clear=False,
            ):
                guard = remote.RendererGuard("http://localhost/command/", 4)
            self.assertEqual(
                guard._read_database(), ("aplactive", "spotactive"),
            )

    def test_direct_database_failure_falls_back_to_http(self):
        guard = remote.RendererGuard("http://localhost/command/", 4)
        with mock.patch.object(
            guard, "_read_database", side_effect=sqlite3.OperationalError("busy"),
        ), mock.patch.object(
            guard, "_read_http", return_value=("rxactive",),
        ) as read_http:
            self.assertEqual(guard.check(), ("rxactive",))
        read_http.assert_called_once_with()


class MoodeWorkerTests(unittest.TestCase):
    def test_active_renderer_prevents_http_request(self):
        guard = FakeRendererGuard(False)
        worker = remote.MoodeWorker(
            "http://localhost/command/", 1, renderer_guard=guard,
        )
        with mock.patch.object(remote.urllib.request, "urlopen") as urlopen:
            worker.start()
            worker.submit("Play/Pause", "toggle_play_pause")
            worker.stop()
            worker.thread.join(1)
        self.assertFalse(worker.thread.is_alive())
        urlopen.assert_not_called()
        self.assertEqual(guard.actions, ["Play/Pause"])


class FakeAppleMusic:
    def __init__(self, active, visible=False):
        self._active = active
        self._visible = visible
        self.controls = []
        self.windows = []

    def action_for(self, command):
        return remote.AppleMusicBridge.ACTIONS.get(command.partition(" ")[0])

    def running(self):
        return True

    def active(self):
        return self._active

    def visible(self):
        return self._visible

    player = False

    def player_open(self):
        return self.player

    def control(self, action):
        self.controls.append(action)
        return {"ok": True, "state": "pause"}

    def window(self, command):
        self.windows.append(command)
        return True


class AppleMusicTests(unittest.TestCase):
    def run_worker(self, apple_music, command, button="Play/Pause"):
        results = []
        worker = remote.MoodeWorker(
            "http://localhost/command/", 1,
            result_handler=lambda *args: results.append(args),
            renderer_guard=FakeRendererGuard(True),
        )
        worker.apple_music = apple_music
        with mock.patch.object(remote.urllib.request, "urlopen") as urlopen:
            worker.start()
            worker.submit(button, command)
            worker.stop()
            worker.thread.join(1)
        return urlopen, results

    def test_play_pause_controls_apple_music_while_it_is_the_source(self):
        apple_music = FakeAppleMusic(True)
        urlopen, results = self.run_worker(apple_music, "toggle_play_pause")
        urlopen.assert_not_called()
        self.assertEqual(apple_music.controls, ["toggle"])
        self.assertEqual(results[0][2], b'{"state": "pause"}')

    def test_volume_stays_with_moode_while_apple_music_plays(self):
        apple_music = FakeAppleMusic(True)
        urlopen, _results = self.run_worker(apple_music, "set_volume -up 5", "Volume +")
        self.assertEqual(apple_music.controls, [])
        urlopen.assert_called_once()

    def test_play_pause_controls_mpd_when_apple_music_is_not_the_source(self):
        apple_music = FakeAppleMusic(False)
        urlopen, _results = self.run_worker(apple_music, "toggle_play_pause")
        self.assertEqual(apple_music.controls, [])
        urlopen.assert_called_once()

    def test_bridge_reads_fresh_state_and_ignores_stale_state(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "state.json")
            bridge = remote.AppleMusicBridge("http://localhost/command/", 1)
            self.assertEqual(bridge.url, "http://localhost/applemusic.php")
            hidden = os.path.join(directory, "hidden")
            open(hidden, "w").close()
            with mock.patch.object(remote.AppleMusicBridge, "STATE_FILE", path), \
                    mock.patch.object(remote.AppleMusicBridge, "HIDDEN_FILE", hidden), \
                    mock.patch.object(remote.AppleMusicBridge, "_mpd_playing", return_value=False) as mpd:
                self.assertFalse(bridge.active())
                with open(path, "w", encoding="utf-8") as handle:
                    handle.write('{"time": %f, "playing": false, "item": {"title": "x"}}' % remote.time.time())
                self.assertTrue(bridge.active())
                mpd.return_value = True
                self.assertFalse(bridge.active())        # hidden, paused, MPD plays
                os.remove(hidden)
                self.assertTrue(bridge.active())         # on screen: always Apple Music
                with open(path, "w", encoding="utf-8") as handle:
                    handle.write('{"time": %f, "playing": true, "item": null}' % (remote.time.time() - 60))
                self.assertFalse(bridge.active())

    def run_visible(self, player):
        apple_music = FakeAppleMusic(True, visible=True)
        apple_music.player = player
        worker = FakeWorker()
        with mock.patch.dict(os.environ, {"SIRI_MENU_SCREEN_CLICK": "yes",
                                          "SIRI_LIBRARY_NAVIGATION": "yes"}, clear=False):
            clicker = remote.X11ClickWorker(FakeRendererGuard(True))
        clicker.apple_music = apple_music
        clicker.moode_worker = worker
        with mock.patch.object(clicker, "_ensure_playback"), \
                mock.patch.object(clicker, "_click") as click, \
                mock.patch.object(clicker, "_emit_navigation_key") as key, \
                mock.patch.object(clicker, "_emit_navigation_keys") as keys:
            clicker.start()
            clicker.submit_navigation("select-right")
            clicker.submit_navigation("down")
            clicker.submit_navigation_actions(["right", "continue-right"])
            clicker.stop()
            clicker.thread.join(1)
        click.assert_not_called()
        key.assert_not_called()
        keys.assert_not_called()
        return apple_music, worker

    def test_touchpad_navigates_apple_music_pages(self):
        apple_music, worker = self.run_visible(player=False)
        self.assertEqual(apple_music.controls, ["nav:select", "nav:down", "nav:right,right"])
        self.assertEqual(worker.actions, [])

    def test_touchpad_click_in_apple_music_player_is_next(self):
        apple_music, worker = self.run_visible(player=True)
        self.assertEqual(apple_music.controls, [])
        self.assertEqual(worker.actions, [("Touchpad right / Next", "next")])


    def run_menu(self, apple_music, double=False):
        with mock.patch.dict(os.environ, {"SIRI_MENU_SCREEN_CLICK": "yes",
                                          "SIRI_LIBRARY_NAVIGATION": "yes"}, clear=False):
            clicker = remote.X11ClickWorker(FakeRendererGuard(True))
        clicker.apple_music = apple_music
        with mock.patch.object(clicker, "_ensure_playback"), \
                mock.patch.object(clicker, "_click") as click, \
                mock.patch.object(clicker, "_emit_navigation_key") as key:
            clicker.start()
            clicker.submit_library_menu() if double else clicker.submit()
            clicker.stop()
            clicker.thread.join(1)
        return click, key

    def test_menu_switches_between_apple_music_player_and_home(self):
        apple_music = FakeAppleMusic(True, visible=True)
        apple_music.player = True
        click, _key = self.run_menu(apple_music)
        apple_music.player = False
        self.run_menu(apple_music)
        click.assert_not_called()
        self.assertEqual(apple_music.controls, ["home", "player"])
        self.assertEqual(apple_music.windows, [])

    def test_double_menu_returns_to_moode_source_chooser(self):
        apple_music = FakeAppleMusic(True, visible=True)
        _click, key = self.run_menu(apple_music, double=True)
        self.assertEqual(apple_music.windows, ["hide"])
        key.assert_called_once_with("library-menu")

    def test_bridge_player_open_reads_view(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "state.json")
            bridge = remote.AppleMusicBridge("http://localhost/command/", 1)
            with mock.patch.object(remote.AppleMusicBridge, "STATE_FILE", path):
                for state, expected in (({"view": {"player": True}}, True),
                                        ({"view": {"player": False}}, False),
                                        ({}, False)):
                    state["time"] = remote.time.time()
                    with open(path, "w", encoding="utf-8") as handle:
                        handle.write(remote.json.dumps(state))
                    self.assertEqual(bridge.player_open(), expected, state)

    def test_hidden_apple_music_leaves_moode_navigation_alone(self):
        apple_music = FakeAppleMusic(True, visible=False)
        worker = FakeWorker()
        with mock.patch.dict(os.environ, {"SIRI_MENU_SCREEN_CLICK": "yes",
                                          "SIRI_LIBRARY_NAVIGATION": "yes"}, clear=False):
            clicker = remote.X11ClickWorker(FakeRendererGuard(True))
        clicker.apple_music = apple_music
        clicker.moode_worker = worker
        views = iter(["playback,radio", "album"])
        with mock.patch.object(clicker, "_ensure_playback"), \
                mock.patch.object(clicker, "_click") as click, \
                mock.patch.object(clicker, "_get_current_view", side_effect=lambda: next(views)), \
                mock.patch.object(clicker, "_emit_navigation_key") as key, \
                mock.patch.object(clicker, "_emit_navigation_keys") as keys:
            clicker.start()
            clicker.submit()                              # Menu: normal moOde click
            clicker.submit_navigation("select-left")      # Playback: Apple Music previous
            clicker.submit_navigation("select-right")     # Album view: normal activation
            clicker.submit_navigation_actions(["down"])   # swipe: normal moOde focus
            clicker.stop()
            clicker.thread.join(1)
        click.assert_called_once()
        self.assertEqual(apple_music.windows, [])
        self.assertEqual(worker.actions, [("Touchpad left / Previous", "previous")])
        self.assertIn(mock.call("select-right"), key.call_args_list)
        keys.assert_called_once_with(["down"])


class X11ClickWorkerTests(unittest.TestCase):
    def test_active_renderer_prevents_menu_click(self):
        guard = FakeRendererGuard(False)
        with mock.patch.dict(
            os.environ, {"SIRI_MENU_SCREEN_CLICK": "yes"}, clear=False
        ):
            clicker = remote.X11ClickWorker(guard)
        with mock.patch.object(clicker, "_ensure_playback"), \
                mock.patch.object(clicker, "_click") as click:
            clicker.start()
            clicker.submit()
            clicker.stop()
            clicker.thread.join(1)
        self.assertFalse(clicker.thread.is_alive())
        click.assert_not_called()
        self.assertEqual(guard.actions, ["Menu/Back"])

    def test_navigation_and_continuation_emit_private_keys_when_renderer_allows_it(self):
        guard = FakeRendererGuard(True)
        with mock.patch.dict(
            os.environ,
            {"SIRI_MENU_SCREEN_CLICK": "no", "SIRI_LIBRARY_NAVIGATION": "yes"},
            clear=False,
        ):
            clicker = remote.X11ClickWorker(guard)
        with mock.patch.object(clicker, "_ensure_playback") as ensure_playback, \
                mock.patch.object(clicker, "_emit_navigation_key") as emit:
            clicker.start()
            clicker.submit_navigation("right")
            clicker.submit_navigation("continue-right")
            clicker.stop()
            clicker.thread.join(1)
        ensure_playback.assert_not_called()
        self.assertEqual(
            emit.call_args_list,
            [mock.call("right"), mock.call("continue-right")],
        )
        self.assertEqual(guard.actions, ["Library navigation", "Library navigation"])

    def test_double_menu_emits_library_source_key(self):
        guard = FakeRendererGuard(True)
        with mock.patch.dict(
            os.environ,
            {"SIRI_MENU_SCREEN_CLICK": "yes", "SIRI_LIBRARY_NAVIGATION": "yes"},
            clear=False,
        ):
            clicker = remote.X11ClickWorker(guard)
        with mock.patch.object(clicker, "_ensure_playback"), \
                mock.patch.object(clicker, "_emit_navigation_key") as emit:
            clicker.start()
            clicker.submit_library_menu()
            clicker.stop()
            clicker.thread.join(1)
        emit.assert_called_once_with("library-menu")
        self.assertEqual(guard.actions, ["Menu/Back"])

    def test_single_menu_arms_browser_idle_return_after_click(self):
        guard = FakeRendererGuard(True)
        with mock.patch.dict(
            os.environ,
            {"SIRI_MENU_SCREEN_CLICK": "yes", "SIRI_LIBRARY_NAVIGATION": "yes"},
            clear=False,
        ):
            clicker = remote.X11ClickWorker(guard)
        with mock.patch.object(clicker, "_ensure_playback"), \
                mock.patch.object(clicker, "_click") as click, \
                mock.patch.object(clicker, "_emit_navigation_key") as emit:
            clicker.start()
            clicker.submit()
            clicker.stop()
            clicker.thread.join(1)
        click.assert_called_once_with()
        emit.assert_called_once_with("activity")
        self.assertEqual(guard.actions, ["Menu/Back"])

    def test_invalid_navigation_action_is_rejected(self):
        with mock.patch.dict(
            os.environ, {"SIRI_LIBRARY_NAVIGATION": "yes"}, clear=False,
        ):
            clicker = remote.X11ClickWorker()
        with self.assertRaisesRegex(ValueError, "invalid"):
            clicker.submit_navigation("diagonal")

    def test_menu_uses_actual_moode_view_for_both_directions(self):
        env = {
            "SIRI_MENU_SCREEN_CLICK": "yes",
            "SIRI_MENU_CLICK_X": "360",
            "SIRI_MENU_CLICK_Y": "960",
            "SIRI_PLAYBACK_CLICK_X": "220",
            "SIRI_PLAYBACK_CLICK_Y": "1135",
        }
        with mock.patch.dict(os.environ, env, clear=False):
            clicker = remote.X11ClickWorker()
        with mock.patch.object(clicker, "_emit_click") as emit, \
                mock.patch.object(clicker, "_find_coverart", return_value=(360, 320)), \
                mock.patch.object(
                    clicker, "_get_current_view", side_effect=["playback,album", "album"]
                ):
            clicker._click()
            clicker._click()
        self.assertEqual(
            emit.call_args_list,
            [mock.call(360, 320), mock.call(220, 1135)],
        )

    def test_menu_supports_every_library_origin_in_both_directions(self):
        for origin in ("radio", "album", "folder", "tag", "playlist"):
            with self.subTest(origin=origin):
                with mock.patch.dict(
                    os.environ, {"SIRI_MENU_SCREEN_CLICK": "yes"}, clear=False
                ):
                    clicker = remote.X11ClickWorker()
                with mock.patch.object(clicker, "_emit_click") as emit, \
                        mock.patch.object(
                            clicker, "_find_coverart", return_value=(360, 320)
                        ), mock.patch.object(
                            clicker,
                            "_get_current_view",
                            side_effect=[f"playback,{origin}", origin],
                        ):
                    clicker._click()
                    clicker._click()
                self.assertEqual(
                    emit.call_args_list,
                    [mock.call(360, 320), mock.call(220, 1135)],
                )

    def test_startup_sync_uses_playback_coordinate(self):
        env = {
            "SIRI_MENU_SCREEN_CLICK": "yes",
            "SIRI_PLAYBACK_CLICK_X": "220",
            "SIRI_PLAYBACK_CLICK_Y": "1135",
            "SIRI_X_READY_TIMEOUT": "0",
        }
        with mock.patch.dict(os.environ, env, clear=False):
            clicker = remote.X11ClickWorker()
        with mock.patch.object(clicker, "_emit_click") as emit:
            clicker._ensure_playback()
        emit.assert_called_once_with(220, 1135)

    def test_cover_target_scales_with_display(self):
        self.assertEqual(remote.X11ClickWorker._coverart_target(720, 1280), (360, 320))
        self.assertEqual(remote.X11ClickWorker._coverart_target(1080, 1920), (540, 480))

    def test_cover_target_refuses_invalid_display(self):
        with self.assertRaisesRegex(RuntimeError, "invalid"):
            remote.X11ClickWorker._coverart_target(0, 1280)


class X11OverlayTests(unittest.TestCase):
    def test_blend_pixel_applies_tint_and_opacity(self):
        self.assertEqual(
            remote.X11Overlay._blend_pixel(0x000000, 0xC0C0C0, 0.5),
            0x606060,
        )

    def test_overlay_colors_and_glass_parameters(self):
        self.assertEqual(remote.X11Overlay.MOODE_GREY, 0x101318)
        self.assertEqual(remote.X11Overlay.MOODE_TEXT, (240 / 255.0,) * 3)
        self.assertEqual(remote.X11Overlay.OVERLAY_OPACITY, 0.90)
        self.assertEqual(remote.X11Overlay.OVERLAY_BORDER_OPACITY, 0.48)
        self.assertEqual(remote.X11Overlay.OVERLAY_BORDER_WIDTH, 0.004)
        self.assertEqual(remote.X11Overlay.GLASS_BLUR_DOWNSAMPLE, 8)
        self.assertEqual(remote.X11Overlay.GLASS_HIGHLIGHT_OPACITY, 0.16)
        self.assertEqual(remote.X11Overlay.GLASS_SHADOW_OPACITY, 0.18)
        self.assertEqual(remote.X11Overlay.REPAINT_SETTLE_SECONDS, 0.05)
        self.assertEqual(remote.X11Overlay.COVER_CENTER_Y_RATIO, 0.29375)

    def test_shutdown_ring_is_centered_and_enlarged_for_every_frame(self):
        self.assertEqual(remote.X11Overlay.SHUTDOWN_RING_CENTER_Y, 0.50)
        self.assertEqual(remote.X11Overlay.SHUTDOWN_RING_RADIUS, 0.25)
        self.assertEqual(remote.X11Overlay.SHUTDOWN_RING_LINE_WIDTH, 0.032)
        self.assertEqual(remote.X11Overlay.SHUTDOWN_DIGIT_SIZE, 0.36)

    def test_overlay_is_centered_inside_portrait_cover(self):
        size, left, top = remote.X11Overlay._overlay_geometry(720, 1280)
        self.assertEqual((size, left, top), (536, 92, 108))
        self.assertEqual(left + size // 2, 360)
        self.assertEqual(top + size // 2, 376)

    def test_play_is_a_vector_symbol(self):
        self.assertEqual(
            remote.X11Overlay.SYMBOLS,
            {"PLAY", "PAUSE", "NEXT", "PREVIOUS", "BATTERY"},
        )

    def test_text_layout_scales_and_normalizes(self):
        text, scale, width, height = remote.X11Overlay._text_layout("test!", 360)
        self.assertEqual(text, "TEST?")
        self.assertGreaterEqual(scale, 5)
        self.assertLess(width, 360)
        self.assertEqual(height, scale * 7)

    def test_disabled_overlay_has_every_required_glyph(self):
        self.assertTrue(set("DISABLED") <= remote.X11Overlay.FONT_5X7.keys())

    def test_short_text_scales_with_large_overlay(self):
        _text, small_scale, _width, _height = remote.X11Overlay._text_layout("TEST", 360)
        _text, large_scale, width, _height = remote.X11Overlay._text_layout("TEST", 696)
        self.assertGreater(large_scale, small_scale)
        self.assertLess(width, 696)


class OverlayWorkerTests(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(
            os.environ,
            {"SIRI_OVERLAY": "yes", "SIRI_OVERLAY_SECONDS": "1"},
            clear=False,
        )
        self.env.start()
        self.worker = remote.OverlayWorker()

    def tearDown(self):
        self.env.stop()

    def test_volume_response_uses_returned_percentage(self):
        self.worker.moode_result(
            "Volume +", "set_volume -up 5", b'{"volume":"60","muted":"no"}',
        )
        self.assertEqual(
            self.worker.latest,
            ("command", [("VOLUME:60%", 1.0)]),
        )

    def test_toggle_response_uses_resulting_state(self):
        self.worker.moode_result(
            "Play/Pause", "toggle_play_pause", b'{"state":"play"}',
        )
        self.assertEqual(self.worker.latest[1][0][0], "PLAY")
        self.worker.moode_result(
            "Play/Pause", "toggle_play_pause", b'{"state":"stop"}',
        )
        self.assertEqual(self.worker.latest[1][0][0], "PAUSE")

    def test_navigation_response_uses_button_and_accepts_non_json_body(self):
        self.worker.moode_result(
            "Touchpad left / Previous", "custom-previous", b"",
        )
        self.assertEqual(self.worker.latest[1][0][0], "PREVIOUS")
        self.worker.moode_result(
            "Touchpad right / Next", "custom-next", b"OK",
        )
        self.assertEqual(self.worker.latest[1][0][0], "NEXT")

    def test_latest_volume_replaces_stale_pending_volume(self):
        for volume in ("50", "55", "60"):
            self.worker.moode_result(
                "Volume +",
                "set_volume -up 5",
                ('{"volume":"%s"}' % volume).encode(),
            )
        self.assertEqual(self.worker.latest[1], [("VOLUME:60%", 1.0)])

    def test_shutdown_sequence_counts_down_without_fifo_items(self):
        self.worker.start_shutdown(3.0)
        self.assertEqual(
            self.worker.latest,
            (
                "shutdown",
                [
                    ("SHUTDOWN:3", 1.0),
                    ("SHUTDOWN:2", 1.0),
                    ("SHUTDOWN:1", 1.0),
                ],
            ),
        )

class BatteryMonitorTests(unittest.TestCase):
    def test_manual_show_uses_cached_level_for_one_second(self):
        overlay = FakeOverlayWorker()
        monitor = remote.BatteryMonitor(overlay, threshold=10)
        monitor.update(76)
        monitor.show_current()
        self.assertEqual(
            overlay.submissions,
            [("BATTERY:76%", 1.0, "battery-manual")],
        )

    def test_early_manual_show_waits_for_initial_reading(self):
        overlay = FakeOverlayWorker()
        monitor = remote.BatteryMonitor(overlay, threshold=10)
        monitor.show_current()
        self.assertEqual(overlay.submissions, [])
        monitor.update(76)
        self.assertEqual(
            overlay.submissions,
            [("BATTERY:76%", 1.0, "battery-manual")],
        )

    def test_five_to_nine_shows_one_second_warning(self):
        overlay = FakeOverlayWorker()
        monitor = remote.BatteryMonitor(
            overlay, threshold=10, critical_threshold=5,
        )
        self.assertTrue(monitor.update(9))
        self.assertEqual(
            overlay.submissions,
            [("BATTERY:9%", 1.0, "battery-low")],
        )

    def test_below_five_flashes_three_times(self):
        overlay = FakeOverlayWorker()
        monitor = remote.BatteryMonitor(
            overlay, threshold=10, critical_threshold=5,
        )
        self.assertTrue(monitor.update(4))
        self.assertEqual(
            overlay.sequences,
            [
                (
                    [
                        ("BATTERY:4%", 0.45),
                        ("HIDE", 0.25),
                        ("BATTERY:4%", 0.45),
                        ("HIDE", 0.25),
                        ("BATTERY:4%", 0.45),
                    ],
                    "battery-critical",
                )
            ],
        )

    def test_ten_stops_periodic_warning(self):
        overlay = FakeOverlayWorker()
        monitor = remote.BatteryMonitor(overlay, threshold=10)
        self.assertTrue(monitor.update(9))
        overlay.submissions.clear()
        self.assertFalse(monitor.update(10))
        self.assertEqual(overlay.submissions, [])
        self.assertEqual(overlay.sequences, [])

    def test_invalid_battery_level_is_ignored(self):
        overlay = FakeOverlayWorker()
        monitor = remote.BatteryMonitor(overlay, threshold=10)
        self.assertFalse(monitor.update(101))
        self.assertEqual(overlay.submissions, [])
        self.assertEqual(overlay.sequences, [])

class RawAttClientTests(unittest.TestCase):
    def test_mgmt_connection_parameters_target_only_the_siri_remote(self):
        payload = remote.mgmt_connection_parameter_payload(
            "70:48:0F:F2:65:99",
            remote.BDADDR_LE_PUBLIC,
            200,
        )
        values = struct.unpack("<H6sBHHHH", payload)
        self.assertEqual(values[0], 1)
        self.assertEqual(values[1], bytes.fromhex("9965f20f4870"))
        self.assertEqual(values[2:], (1, 24, 40, 0, 200))

    def test_mgmt_connection_parameters_use_requested_interval(self):
        payload = remote.mgmt_connection_parameter_payload(
            "70:48:0F:F2:65:99",
            remote.BDADDR_LE_PUBLIC,
            200,
            12,
            24,
        )
        values = struct.unpack("<H6sBHHHH", payload)
        self.assertEqual(values[3:], (12, 24, 0, 200))

    def test_battery_interval_tracks_latest_att_reading(self):
        client = remote.RawAttClient(
            "70:48:0F:F2:65:99", "public", "medium",
        )
        expected = ((80, 900), (10, 900), (9, 300), (5, 300), (4, 60))
        for level, interval in expected:
            with self.subTest(level=level):
                client.battery_level = level
                self.assertEqual(
                    client.battery_interval(900, 300, 60, 10, 5),
                    interval,
                )


if __name__ == "__main__":
    unittest.main()
