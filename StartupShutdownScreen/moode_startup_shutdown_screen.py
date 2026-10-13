#!/usr/bin/env python3
"""Draw a moOde boot/shutdown screen directly on a Linux framebuffer."""

import argparse
import mmap
import os
from pathlib import Path
import subprocess
import sys
import time

try:
    import fcntl
except ImportError:  # Allows the pure helper tests to run on Windows.
    fcntl = None


DEFAULT_FB = Path("/dev/fb0")
DEFAULT_FB_SYSFS = Path("/sys/class/graphics/fb0")
DEFAULT_LOGO = Path("/usr/local/share/moode-startup-shutdown/moode-logotype.png")
READY_SERVICES = ("nginx.service", "php8.4-fpm.service", "mpd.service")
KDSETMODE = 0x4B3A
KD_TEXT = 0x00
KD_GRAPHICS = 0x01


def smoothstep(value):
    value = min(1.0, max(0.0, float(value)))
    return value * value * (3.0 - 2.0 * value)


def rgb565(red, green, blue):
    """Return a little-endian RGB565 pixel."""
    packed = ((red & 0xF8) << 8) | ((green & 0xFC) << 3) | (blue >> 3)
    return bytes((packed & 0xFF, packed >> 8))


def should_show_shutdown(state=None):
    """Only animate ExecStop during a real system shutdown/reboot."""
    if state is None:
        result = subprocess.run(
            ["systemctl", "is-system-running"],
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        state = result.stdout
    return state.strip() == "stopping"


def service_is_active(service):
    return subprocess.run(
        ["systemctl", "is-active", "--quiet", service],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    ).returncode == 0


class Geometry:
    def __init__(self, width, height, stride, bits_per_pixel):
        self.width = width
        self.height = height
        self.stride = stride
        self.bits_per_pixel = bits_per_pixel

    @classmethod
    def from_sysfs(cls, root):
        root = Path(root)
        width, height = (
            int(part) for part in (root / "virtual_size").read_text().strip().split(",")
        )
        stride = int((root / "stride").read_text().strip())
        bits_per_pixel = int((root / "bits_per_pixel").read_text().strip())
        if bits_per_pixel != 16:
            raise RuntimeError(
                f"Framebuffer must use 16 bpp RGB565; detected {bits_per_pixel} bpp"
            )
        if stride < width * 2:
            raise RuntimeError(f"Framebuffer stride {stride} is smaller than {width * 2}")
        return cls(width, height, stride, bits_per_pixel)


class FramebufferScreen:
    TRACK = rgb565(75, 77, 79)
    ORANGE_TOP = (255, 126, 18)
    ORANGE_BOTTOM = (210, 75, 0)

    def __init__(self, framebuffer, sysfs, logo):
        self.framebuffer = Path(framebuffer)
        self.geometry = Geometry.from_sysfs(sysfs)
        self.logo = Path(logo)
        self.fd = None
        self.mapping = None
        self.base = None
        self.bar = None

    def __enter__(self):
        self.fd = os.open(self.framebuffer, os.O_RDWR)
        self.mapping = mmap.mmap(
            self.fd,
            self.geometry.stride * self.geometry.height,
            access=mmap.ACCESS_WRITE,
        )
        return self

    def __exit__(self, _type, _value, _traceback):
        if self.mapping is not None:
            self.mapping.close()
        if self.fd is not None:
            os.close(self.fd)

    @staticmethod
    def _font_path():
        candidates = (
            Path("/var/www/fonts/Lato-Regular.ttf"),
            Path("/usr/share/fonts/truetype/lato/Lato-Regular.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        )
        for candidate in candidates:
            if candidate.is_file():
                return candidate
        raise RuntimeError("No suitable Lato or DejaVu Sans font found")

    def render_base(self, mode):
        width = self.geometry.width
        height = self.geometry.height
        label = "Starting moOde" if mode == "startup" else "Shutting down"
        logo_width = max(220, round(width * 0.72))
        logo_y = round(height * 0.35)
        font_size = max(22, round(width * 0.045))
        label_y = round(height * 0.55)

        bar_width = round(width * 0.70)
        bar_height = max(12, round(height * 0.012))
        bar_x = (width - bar_width) // 2
        bar_y = round(height * 0.63)
        radius = max(2, bar_height // 2)
        self.bar = (bar_x, bar_y, bar_width, bar_height, radius)

        font = str(self._font_path()).replace("\\", "\\\\").replace(":", "\\:")
        text = label.replace("'", "\\'")
        filter_graph = (
            f"[1:v]scale={logo_width}:-1:flags=lanczos[logo];"
            f"[0:v][logo]overlay=(W-w)/2:{logo_y}:format=auto,"
            f"drawtext=fontfile='{font}':text='{text}':"
            f"fontcolor=white@0.88:fontsize={font_size}:x=(w-text_w)/2:y={label_y},"
            f"drawbox=x={bar_x}:y={bar_y}:w={bar_width}:h={bar_height}:"
            "color=white@0.20:t=fill"
        )
        command = [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", f"color=c=#0b0d11:s={width}x{height}:r=1",
            "-i", str(self.logo),
            "-filter_complex", filter_graph,
            "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb565le", "pipe:1",
        ]
        result = subprocess.run(
            command,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        expected = width * height * 2
        if len(result.stdout) != expected:
            raise RuntimeError(
                f"ffmpeg returned {len(result.stdout)} bytes; expected {expected}"
            )
        self.base = bytearray(result.stdout)

    def _paint_progress(self, frame, progress):
        bar_x, bar_y, bar_width, bar_height, radius = self.bar
        fill_width = max(0, min(bar_width, round(bar_width * progress)))
        if fill_width <= 0:
            return
        fill_width = min(bar_width, max(bar_height, fill_width))
        row_bytes = self.geometry.width * 2
        for local_y in range(bar_height):
            ratio = local_y / max(1, bar_height - 1)
            color = rgb565(
                round(self.ORANGE_TOP[0] * (1 - ratio) + self.ORANGE_BOTTOM[0] * ratio),
                round(self.ORANGE_TOP[1] * (1 - ratio) + self.ORANGE_BOTTOM[1] * ratio),
                round(self.ORANGE_TOP[2] * (1 - ratio) + self.ORANGE_BOTTOM[2] * ratio),
            )
            dy = abs(local_y - (bar_height - 1) / 2)
            inset = 0
            if dy > (bar_height / 2 - radius):
                inset = max(
                    0,
                    round(radius - max(0.0, radius * radius - dy * dy) ** 0.5),
                )
            start_x = bar_x + min(inset, max(0, fill_width // 2 - 1))
            end_x = max(start_x + 1, bar_x + fill_width - inset)
            offset = (bar_y + local_y) * row_bytes + start_x * 2
            frame[offset:offset + (end_x - start_x) * 2] = color * (end_x - start_x)

    def draw(self, progress):
        if self.base is None:
            raise RuntimeError("render_base() must be called before draw()")
        frame = bytearray(self.base)
        self._paint_progress(frame, min(1.0, max(0.0, progress)))
        width_bytes = self.geometry.width * 2
        if self.geometry.stride == width_bytes:
            self.mapping.seek(0)
            self.mapping.write(frame)
        else:
            for y in range(self.geometry.height):
                source = y * width_bytes
                target = y * self.geometry.stride
                self.mapping[target:target + width_bytes] = frame[source:source + width_bytes]
        self.mapping.flush()


def activate_splash_console(tty_number=8):
    """Activate a quiet VT and prevent fbcon from repainting its framebuffer."""
    tty_path = f"/dev/tty{tty_number}"
    tty_fd = None
    try:
        if fcntl is None:
            raise OSError("fcntl is unavailable on this platform")
        tty_fd = os.open(tty_path, os.O_RDWR | os.O_NOCTTY)
        subprocess.run(
            ["chvt", str(tty_number)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        # Clear/hide the text console once, then detach fbcon from the visible
        # framebuffer. Messages may continue to be logged, but cannot repaint
        # pixels until another program changes this VT back to KD_TEXT.
        os.write(tty_fd, b"\033[2J\033[H\033[?25l")
        fcntl.ioctl(tty_fd, KDSETMODE, KD_GRAPHICS)
    except (OSError, subprocess.CalledProcessError) as error:
        print(
            f"moode-startup-shutdown-screen: could not activate tty{tty_number}: {error}",
            file=sys.stderr,
        )
    finally:
        if tty_fd is not None:
            os.close(tty_fd)


def find_xorg_vt():
    """Return the VT number selected by Xorg, or None while Xorg is absent."""
    result = subprocess.run(
        ["ps", "-C", "Xorg", "-o", "tty="],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    for value in result.stdout.splitlines():
        value = value.strip()
        if value.startswith("tty") and value[3:].isdigit():
            return int(value[3:])
    return None


def release_splash_console(target_vt=None, tty_number=8):
    """Return tty8 to text mode and hand the display to Xorg (or tty1)."""
    tty_fd = None
    try:
        if fcntl is None:
            raise OSError("fcntl is unavailable on this platform")
        tty_fd = os.open(f"/dev/tty{tty_number}", os.O_RDWR | os.O_NOCTTY)
        fcntl.ioctl(tty_fd, KDSETMODE, KD_TEXT)
    finally:
        if tty_fd is not None:
            os.close(tty_fd)
    subprocess.run(
        ["chvt", str(target_vt or 1)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def wait_for_framebuffer(framebuffer, sysfs, timeout=10.0):
    deadline = time.monotonic() + timeout
    required = (
        Path(framebuffer),
        Path(sysfs) / "virtual_size",
        Path(sysfs) / "stride",
        Path(sysfs) / "bits_per_pixel",
    )
    last_problem = "framebuffer paths are not available"
    while True:
        if all(path.exists() for path in required):
            try:
                bits_per_pixel = int((Path(sysfs) / "bits_per_pixel").read_text().strip())
                if bits_per_pixel == 16:
                    return
                last_problem = f"framebuffer still reports {bits_per_pixel} bpp"
            except (OSError, ValueError) as error:
                last_problem = f"framebuffer metadata is not ready: {error}"
        if time.monotonic() >= deadline:
            missing = ", ".join(str(path) for path in required if not path.exists())
            detail = f"missing {missing}" if missing else last_problem
            raise RuntimeError(f"RGB565 framebuffer did not become ready: {detail}")
        time.sleep(0.1)


def animate_startup(screen, duration, timeout):
    started = time.monotonic()
    progress = 0.04
    target_vt = None
    while True:
        elapsed = time.monotonic() - started
        active = sum(service_is_active(name) for name in READY_SERVICES)
        services_progress = active / len(READY_SERVICES)
        time_progress = min(1.0, elapsed / max(0.1, duration))
        progress = 0.04 + 0.80 * max(time_progress * 0.72, services_progress)
        screen.draw(progress)

        target_vt = find_xorg_vt()
        if target_vt is not None:
            break
        if elapsed >= timeout:
            break
        time.sleep(0.10)

    finish_started = time.monotonic()
    finish_duration = 0.55
    finish_from = min(0.90, progress)
    while True:
        ratio = (time.monotonic() - finish_started) / finish_duration
        screen.draw(finish_from + (1.0 - finish_from) * smoothstep(ratio))
        if ratio >= 1.0:
            break
        time.sleep(0.04)
    time.sleep(0.15)
    return target_vt


def animate_shutdown(screen, duration):
    started = time.monotonic()
    while True:
        ratio = (time.monotonic() - started) / max(0.1, duration)
        screen.draw(smoothstep(ratio))
        if ratio >= 1.0:
            break
        time.sleep(0.04)
    time.sleep(0.15)


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("startup", "shutdown", "shutdown-if-stopping"))
    parser.add_argument("--duration", type=float)
    parser.add_argument("--startup-timeout", type=float, default=120.0)
    parser.add_argument("--framebuffer", type=Path, default=DEFAULT_FB)
    parser.add_argument("--sysfs", type=Path, default=DEFAULT_FB_SYSFS)
    parser.add_argument("--logo", type=Path, default=DEFAULT_LOGO)
    return parser.parse_args()


def main():
    args = parse_args()
    if args.mode == "shutdown-if-stopping" and not should_show_shutdown():
        return 0
    mode = "shutdown" if args.mode.startswith("shutdown") else "startup"
    duration = args.duration if args.duration is not None else (4.5 if mode == "startup" else 3.5)
    wait_for_framebuffer(args.framebuffer, args.sysfs)
    activate_splash_console()
    target_vt = None
    try:
        with FramebufferScreen(args.framebuffer, args.sysfs, args.logo) as screen:
            screen.render_base(mode)
            if mode == "startup":
                target_vt = animate_startup(screen, duration, args.startup_timeout)
            else:
                animate_shutdown(screen, duration)
    finally:
        if mode == "startup":
            release_splash_console(target_vt)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"moode-startup-shutdown-screen: {error}", file=sys.stderr)
        sys.exit(1)
