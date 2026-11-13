<?php
/*
 * Apple Music bridge for moOde (AppleMusic project).
 * POST applemusic.php?cmd=open|close|toggle|hide|show   Apple Music on the local display
 * GET  applemusic.php?cmd=status              running|hidden|stopped
 * GET  applemusic.php?cmd=volume              CamillaDSP volume for the Apple Music slider
 * POST applemusic.php?cmd=volume&level=0..100 set CamillaDSP volume directly
 * GET  applemusic.php?cmd=state               now playing, for the moOde UI
 * GET  applemusic.php?cmd=settings            service on/off and sign-in state (Renderers page)
 * POST applemusic.php?cmd=enable|disable      turn the service on or off
 * POST applemusic.php?cmd=signin|signout      Apple's sign-in/out on the Pi's screen
 * POST applemusic.php?cmd=control&action=play|pause|toggle|next|prev|home|player
 *                                             (home: close the player and show Home;
 *                                              player: open the full-screen player)
 * POST applemusic.php?cmd=control&action=nav:left|right|up|down|select[,...]
 *                                             remote focus navigation in Apple Music
 * POST applemusic.php?cmd=sync                from the Apple Music extension (JSON body):
 *                                             stores now playing, returns commands + volume
 */
header('Content-Type: application/json');
header('Cache-Control: no-store');

const MOODE_DB = '/var/local/www/db/moode-sqlite3.db';

function moode_cfg(array $params): array {
    $db = new SQLite3(MOODE_DB, SQLITE3_OPEN_READONLY);
    $db->busyTimeout(500);
    $quoted = array_map(function ($p) { return "'" . SQLite3::escapeString($p) . "'"; }, $params);
    $res = $db->query('SELECT param, value FROM cfg_system WHERE param IN (' . implode(',', $quoted) . ')');
    $out = [];
    while ($row = $res->fetchArray(SQLITE3_ASSOC)) { $out[$row['param']] = $row['value']; }
    $db->close();
    return $out;
}

const CDSP_STATEFILE = '/var/lib/cdsp/statefile.yml';
const CDSP_VOLUME_CONFIG = '/etc/mpd2cdspvolume.config';
const CDSP_VOLUME_UPDATE = '/var/www/util/cdsp_volume_update.py';

// Same curve as moOde's cdsp_volume_update.py / mpd2cdspvolume: linear in dB
// above 10 %, linear in amplitude below; dynamic range from its config.
function cdsp_curve(): array {
    $range = 60.0; $offset = 0.0;
    $ini = @parse_ini_file(CDSP_VOLUME_CONFIG, true);
    if (is_array($ini) && isset($ini['default'])) {
        if (isset($ini['default']['dynamic_range'])) { $range = (float)$ini['default']['dynamic_range']; }
        if (isset($ini['default']['volume_offset'])) { $offset = abs((float)$ini['default']['volume_offset']); }
    }
    return [$range, $offset];
}

function db_to_level(float $db): int {
    [$range, $offset] = cdsp_curve();
    $db += $offset;
    $a = pow(10, -$range / 20);
    $b = log(pow(10, $range / 20));
    $y = pow(10, $db / 20);
    $x = $y >= $a * exp(0.1 * $b) ? log($y / $a) / $b : $y / (10 * $a * exp(0.1 * $b));
    return max(0, min(100, (int)round($x * 100)));
}

// Minimal websocket client for CamillaDSP's control port (127.0.0.1:1234).
function cdsp_ws_query(array $commands): ?array {
    $s = @stream_socket_client('tcp://127.0.0.1:1234', $errno, $errstr, 0.3);
    if (!$s) { return null; }
    stream_set_timeout($s, 0, 500000);
    $key = base64_encode(random_bytes(16));
    fwrite($s, "GET / HTTP/1.1\r\nHost: 127.0.0.1:1234\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" .
        "Sec-WebSocket-Key: $key\r\nSec-WebSocket-Version: 13\r\n\r\n");
    $head = '';
    while (!feof($s) && strpos($head, "\r\n\r\n") === false) {
        $chunk = fread($s, 1024);
        if ($chunk === '' || $chunk === false) { break; }
        $head .= $chunk;
    }
    if (strpos($head, ' 101 ') === false) { fclose($s); return null; }
    $buffer = substr($head, strpos($head, "\r\n\r\n") + 4);
    $results = [];
    foreach ($commands as $cmd) {
        $payload = json_encode($cmd);
        $mask = random_bytes(4);
        $masked = '';
        for ($i = 0; $i < strlen($payload); $i++) { $masked .= $payload[$i] ^ $mask[$i % 4]; }
        fwrite($s, chr(0x81) . chr(0x80 | strlen($payload)) . $mask . $masked);
        // Read one (unmasked) text frame from the server.
        while (strlen($buffer) < 2) { $c = fread($s, 4096); if ($c === '' || $c === false) { fclose($s); return null; } $buffer .= $c; }
        $len = ord($buffer[1]) & 0x7f; $off = 2;
        if ($len === 126) {
            while (strlen($buffer) < 4) { $c = fread($s, 4096); if ($c === '' || $c === false) { fclose($s); return null; } $buffer .= $c; }
            $len = unpack('n', substr($buffer, 2, 2))[1]; $off = 4;
        }
        while (strlen($buffer) < $off + $len) { $c = fread($s, 4096); if ($c === '' || $c === false) { fclose($s); return null; } $buffer .= $c; }
        $results[$cmd] = json_decode(substr($buffer, $off, $len), true)[$cmd] ?? null;
        $buffer = substr($buffer, $off + $len);
    }
    fclose($s);
    return $results;
}

// Current CamillaDSP main volume/mute. While CamillaDSP runs (audio playing)
// its state file is not kept up to date, so ask CamillaDSP itself first.
function cdsp_main_volume(): ?array {
    $live = cdsp_ws_query(['GetVolume', 'GetMute']);
    if ($live && ($live['GetVolume']['result'] ?? '') === 'Ok') {
        return [(float)$live['GetVolume']['value'], (bool)($live['GetMute']['value'] ?? false)];
    }
    return cdsp_statefile_volume();
}

// CamillaDSP stores its main volume/mute (index 0) in the state file.
function cdsp_statefile_volume(): ?array {
    $text = @file_get_contents(CDSP_STATEFILE);
    if ($text === false) { return null; }
    if (!preg_match('/^volume:\s*\n\s*-\s*(-?[0-9.eE+-]+)/m', $text, $v)) { return null; }
    $muted = preg_match('/^mute:\s*\n\s*-\s*true/m', $text) === 1;
    return [(float)$v[1], $muted];
}

function volume_state(): array {
    $c = moode_cfg(['camilladsp']);
    $cdsp = cdsp_main_volume();
    // Only bridge when CamillaDSP is in moOde's output chain.
    $bridge = ($c['camilladsp'] ?? 'off') !== 'off' && $cdsp !== null && is_executable(CDSP_VOLUME_UPDATE);
    return [
        'bridge' => $bridge,
        'level' => $cdsp === null ? 0 : ($cdsp[1] ? 0 : db_to_level($cdsp[0])),
        'db' => $cdsp === null ? null : round($cdsp[0], 1),
        'muted' => $cdsp !== null && $cdsp[1],
    ];
}

// Runtime state shared with the launcher (tmpfs: written every second).
const RUN_DIR = '/dev/shm/moode-applemusic';
const STATE_FILE = RUN_DIR . '/state.json';
const COMMANDS_FILE = RUN_DIR . '/commands';
const STATE_MAX_AGE = 8;  // seconds without sync = Apple Music not running
// Last known sign-in state; outside RUN_DIR so it survives closing Apple Music.
const AUTH_FILE = '/dev/shm/moode-applemusic-auth.json';

function read_state(): ?array {
    $s = @json_decode((string)@file_get_contents(STATE_FILE), true);
    return is_array($s) ? $s : null;
}

function write_state(array $s): void {
    if (!is_dir(RUN_DIR)) { return; }  // only while the launcher runs Apple Music
    $tmp = STATE_FILE . '.' . getmypid();
    if (@file_put_contents($tmp, json_encode($s)) !== false) { @rename($tmp, STATE_FILE); }
}

// Commands from the moOde UI wait here until the extension's next sync.
function push_command(string $action): bool {
    if (!is_dir(RUN_DIR)) { return false; }
    return @file_put_contents(COMMANDS_FILE, $action . "\n", FILE_APPEND | LOCK_EX) !== false;
}

function take_commands(): array {
    $fh = @fopen(COMMANDS_FILE, 'c+');
    if (!$fh) { return []; }
    flock($fh, LOCK_EX);
    $data = stream_get_contents($fh);
    ftruncate($fh, 0);
    flock($fh, LOCK_UN);
    fclose($fh);
    return array_values(array_filter(array_map('trim', explode("\n", (string)$data))));
}

// Send one command to MPD; returns its "key: value" reply lines.
function mpd_command(string $command): array {
    $s = @stream_socket_client('tcp://127.0.0.1:6600', $errno, $errstr, 0.3);
    if (!$s) { return []; }
    stream_set_timeout($s, 0, 500000);
    fgets($s);  // greeting
    fwrite($s, $command . "\nclose\n");
    $out = [];
    while (($line = fgets($s)) !== false) {
        if (strncmp($line, 'OK', 2) === 0 || strncmp($line, 'ACK', 3) === 0) { break; }
        $p = strpos($line, ': ');
        if ($p !== false) { $out[substr($line, 0, $p)] = trim(substr($line, $p + 2)); }
    }
    fclose($s);
    return $out;
}

function mpd_state(): string {
    return mpd_command('status')['state'] ?? 'unknown';
}

// Output format of the audio device, in moOde's notation ("PCM 24/44.1 kHz, 2ch").
function output_format(): string {
    foreach (glob('/proc/asound/card*/pcm*p/sub*/hw_params') ?: [] as $f) {
        $t = @file_get_contents($f);
        if (!$t || strpos($t, 'closed') === 0) { continue; }
        preg_match('/^format:\s*\S*?(\d+)/m', $t, $fm);
        preg_match('/^rate:\s*(\d+)/m', $t, $rm);
        preg_match('/^channels:\s*(\d+)/m', $t, $cm);
        if ($rm) {
            return 'PCM ' . ($fm[1] ?? '?') . '/' . rtrim(rtrim(number_format($rm[1] / 1000, 1, '.', ''), '0'), '.') .
                ' kHz, ' . ($cm[1] ?? 2) . 'ch';
        }
    }
    return 'Not playing';
}

function app_state(): array {
    $s = read_state();
    $fresh = $s && (microtime(true) - ($s['time'] ?? 0)) < STATE_MAX_AGE;
    if (!$fresh) { return ['app' => 'stopped', 'playing' => false, 'item' => null]; }
    $item = $s['item'] ?? null;
    if ($item && !empty($s['playing'])) {
        // Position as of now, not as of the last sync.
        $item['position'] = min((float)($item['duration'] ?? 0), (float)($item['position'] ?? 0) + microtime(true) - $s['time']);
    }
    return [
        'app' => file_exists(RUN_DIR . '/hidden') ? 'hidden' : 'visible',
        'playing' => !empty($s['playing']),
        'item' => $item,
        'oformat' => !empty($s['playing']) ? output_format() : 'Not playing',
    ];
}

// Restart Chromium's audio process (frees a stuck or failed audio output),
// close Apple Music's resulting error message and play on.
function restart_apple_music_audio(array &$state, array &$commands): void {
    exec('sudo -n /usr/local/bin/moode-applemusic release-audio >/dev/null 2>&1');
    $state['released_at'] = microtime(true);
    $state['stalled_since'] = null;
    $commands[] = 'recover-audio';
}

function clean_item($item): ?array {
    if (!is_array($item)) { return null; }
    // moOde's PHP has no mbstring: cut at 300 UTF-8 characters with a regex.
    $str = function ($v) { return preg_match('/^.{0,300}/su', trim((string)$v), $m) ? $m[0] : ''; };
    $art = (string)($item['artwork'] ?? '');
    return [
        'id' => $str($item['id'] ?? ''),
        'title' => $str($item['title'] ?? ''),
        'artist' => $str($item['artist'] ?? ''),
        'album' => $str($item['album'] ?? ''),
        // Only Apple's own artwork servers.
        'artwork' => preg_match('#^https://[a-z0-9.-]+\.mzstatic\.com/#i', $art) ? $art : '',
        'duration' => max(0, (float)($item['duration'] ?? 0)),
        'position' => max(0, (float)($item['position'] ?? 0)),
    ];
}

// moOde's current theme, for Apple Music's colours.
function theme_state(): array {
    $c = moode_cfg(['themename', 'accent_color', 'cover_backdrop', 'cover_blur', 'cover_scale', 'alphablend']);
    $name = $c['themename'] ?? 'Default';
    $db = new SQLite3(MOODE_DB, SQLITE3_OPEN_READONLY);
    $db->busyTimeout(500);
    $st = $db->prepare('SELECT tx_color, bg_color, mbg_color FROM cfg_theme WHERE theme_name = :n');
    $st->bindValue(':n', $name, SQLITE3_TEXT);
    $row = $st->execute()->fetchArray(SQLITE3_ASSOC) ?: ['tx_color' => 'ddd', 'bg_color' => '32,32,32', 'mbg_color' => '50,50,50,0.75'];
    $db->close();
    $rgb = function ($v, $n) {
        $parts = array_map('trim', explode(',', (string)$v));
        $parts = array_slice(array_map('floatval', $parts), 0, $n);
        return count($parts) === $n ? implode(',', $parts) : null;
    };
    // Accent colour names are defined in moOde's JavaScript only.
    $accent = '#d35400';
    $js = @file_get_contents('/var/www/js/lib.min.js');
    if ($js && preg_match('/case"' . preg_quote($c['accent_color'] ?? '', '/') . '":t="(#[0-9a-fA-F]{6})"/', $js, $m)) {
        $accent = $m[1];
    }
    $tx = preg_match('/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/', $row['tx_color']) ? '#' . $row['tx_color'] : '#ddd';
    $light = hexdec(substr(ltrim($tx, '#'), 0, 1)) >= 8;  // light text = dark theme
    return [
        'name' => $name,
        'dark' => $light,
        'tx' => $tx,
        'bg' => $rgb($row['bg_color'], 3) ?? '32,32,32',
        'mbg' => $rgb($row['mbg_color'], 4) ?? '50,50,50,0.75',
        'accent' => $accent,
        'backdrop' => ($c['cover_backdrop'] ?? 'No') === 'Yes',
        'blur' => preg_match('/^\d+(\.\d+)?px$/', $c['cover_blur'] ?? '') ? $c['cover_blur'] : '5px',
        'scale' => is_numeric($c['cover_scale'] ?? '') ? (float)$c['cover_scale'] : 1.25,
        'alpha' => is_numeric($c['alphablend'] ?? '') ? (float)$c['alphablend'] : 0.75,
    ];
}

$cmd = $_GET['cmd'] ?? '';
$allowed = ['open', 'close', 'toggle', 'status', 'volume', 'hide', 'show', 'state', 'control', 'sync', 'theme',
    'settings', 'enable', 'disable', 'signin', 'signout'];
if (!in_array($cmd, $allowed, true)) {
    http_response_code(400);
    echo json_encode(['error' => 'unknown command']);
    exit;
}
$post = $_SERVER['REQUEST_METHOD'] === 'POST';

if ($cmd === 'state') {
    echo json_encode(app_state());
    exit;
}

// moOde Configure > Renderers: service on/off and Apple Music sign-in.
if ($cmd === 'settings') {
    $auth = @json_decode((string)@file_get_contents(AUTH_FILE), true);
    $app = app_state()['app'];
    exec('sudo -n /usr/local/bin/moode-applemusic enabled 2>/dev/null', $o);
    echo json_encode([
        'enabled' => trim((string)end($o)) !== 'no',
        'app' => $app,
        // Known while Apple Music runs, and remembered after it closes.
        'signed_in' => is_array($auth) ? (bool)$auth['signed_in'] : null,
        'checked' => is_array($auth) ? (int)$auth['time'] : null,
    ]);
    exit;
}

if (in_array($cmd, ['enable', 'disable'], true)) {
    if (!$post) { http_response_code(405); echo json_encode(['error' => 'use POST']); exit; }
    exec('sudo -n /usr/local/bin/moode-applemusic ' . $cmd . ' 2>&1', $out, $rc);
    echo json_encode(['ok' => $rc === 0, 'enabled' => $cmd === 'enable']);
    exit;
}

// Sign in/out happens in Apple's own window on the Pi's screen; no password
// passes through moOde.
if (in_array($cmd, ['signin', 'signout'], true)) {
    if (!$post) { http_response_code(405); echo json_encode(['error' => 'use POST']); exit; }
    $state = app_state()['app'];
    exec('sudo -n /usr/local/bin/moode-applemusic open 2>&1', $out, $rc);
    if ($rc !== 0) { echo json_encode(['ok' => false, 'error' => trim(implode(' ', $out))]); exit; }
    // A fresh Apple Music needs a moment before it can take the command.
    if ($state === 'stopped') {
        for ($i = 0; $i < 60 && !is_dir(RUN_DIR); $i++) { usleep(250000); }
    }
    echo json_encode(['ok' => push_command($cmd), 'started' => $state === 'stopped']);
    exit;
}

if ($cmd === 'theme') {
    echo json_encode(theme_state());
    exit;
}

if ($cmd === 'sync') {
    if (!$post) { http_response_code(405); echo json_encode(['error' => 'use POST']); exit; }
    $in = json_decode((string)file_get_contents('php://input'), true);
    $in = is_array($in) ? $in : [];
    $prev = read_state();
    $playing = !empty($in['playing']);
    $state = ['time' => microtime(true), 'ready' => !empty($in['ready']), 'playing' => $playing, 'item' => clean_item($in['item'] ?? null),
        // Full-screen player open / on the Home page (remote Menu/Back).
        'view' => ['player' => !empty($in['view']['player']), 'home' => !empty($in['view']['home'])]];
    if (isset($in['authorized']) && !empty($in['ready'])) {
        $signedIn = (bool)$in['authorized'];
        $prevAuth = @json_decode((string)@file_get_contents(AUTH_FILE), true);
        if (!is_array($prevAuth) || $prevAuth['signed_in'] !== $signedIn || time() - $prevAuth['time'] > 60) {
            @file_put_contents(AUTH_FILE, json_encode(['signed_in' => $signedIn, 'time' => time()]));
        }
    }
    $commands = take_commands();
    // Apple Music and MPD share the output device: whoever starts last wins.
    $mpd = mpd_command('status');
    $mpdState = $mpd['state'] ?? 'unknown';
    // MPD pauses itself with this error when play is pressed in moOde while
    // Apple Music holds the device. Its errors are cleared whenever Apple Music
    // starts, so an error here is always a play request made after that.
    $mpdWantsDevice = $mpdState === 'play' ||
        ($mpdState === 'pause' && strpos($mpd['error'] ?? '', 'open audio output') !== false);
    $state['released_at'] = $prev['released_at'] ?? 0;
    $position = (float)($state['item']['position'] ?? 0);
    $sameItem = ($state['item']['id'] ?? '') !== '' && ($state['item']['id'] ?? '') === ($prev['item']['id'] ?? '');
    // Playing without the position moving: Chromium's audio output failed.
    $state['stalled_since'] = ($playing && !empty($prev['playing']) && $sameItem &&
        abs($position - (float)($prev['item']['position'] ?? -1)) < 0.5)
        ? ($prev['stalled_since'] ?? microtime(true)) : null;
    if ($playing) {
        if (empty($prev['playing'])) {
            // Apple Music just started: free the device and forget old errors.
            if ($mpdState !== 'stop') {
                exec('mpc -q stop >/dev/null 2>&1');
                // Chromium opened the device while MPD still held it; its
                // CamillaDSP failed with "device busy". Restart Chromium's
                // audio and play again now that the device is free.
                if ($mpdState === 'play') { restart_apple_music_audio($state, $commands); }
            }
            mpd_command('clearerror');
        } elseif ($state['stalled_since'] !== null && microtime(true) - $state['stalled_since'] > 4 &&
            microtime(true) - $state['released_at'] > 10) {
            restart_apple_music_audio($state, $commands);
        } elseif ($mpdWantsDevice) {
            $commands[] = 'pause';
            $state['resume_mpd'] = true;
        }
        if (!empty($prev['resume_mpd'])) { $state['resume_mpd'] = true; }  // pause not done yet
    } elseif ((!empty($prev['resume_mpd']) || $mpdWantsDevice) && $mpdState !== 'play' &&
        microtime(true) - $state['released_at'] > 10) {
        // Apple Music is paused but Chromium still holds the device: free it
        // and let MPD play (at most every 10 s, in case MPD fails otherwise).
        exec('sudo -n /usr/local/bin/moode-applemusic release-audio >/dev/null 2>&1');
        exec('mpc -q play >/dev/null 2>&1');
        $state['released_at'] = microtime(true);
        push_command('dismiss-error');  // Apple Music reports the lost audio process
    }
    write_state($state);
    // Short long-poll: without commands, wait up to 0.9 s for one, so buttons
    // in moOde or on a remote reach Apple Music within ~50 ms. The extension
    // sends its next sync as soon as this one returns.
    if (!$commands && !empty($_GET['wait'])) {
        $until = microtime(true) + 0.9;
        while (microtime(true) < $until) {
            usleep(40000);
            clearstatcache(true, COMMANDS_FILE);
            if (@filesize(COMMANDS_FILE) > 0) { $commands = take_commands(); break; }
        }
    }
    echo json_encode(['commands' => $commands, 'volume' => volume_state()]);
    exit;
}

if ($cmd === 'control') {
    if (!$post) { http_response_code(405); echo json_encode(['error' => 'use POST']); exit; }
    $action = $_GET['action'] ?? '';
    // nav:down or nav:right,right,right: remote focus navigation (applenav.js).
    $isNav = preg_match('/^nav:(left|right|up|down|select)(,(left|right|up|down|select)){0,15}$/', $action) === 1;
    if (!$isNav && !in_array($action, ['play', 'pause', 'toggle', 'next', 'prev', 'home', 'player'], true)) {
        http_response_code(400);
        echo json_encode(['error' => 'unknown action']);
        exit;
    }
    $s = read_state();
    // Resulting state, in the format of moOde's toggle_play_pause (remote OSD).
    $result = ['play' => 'play', 'pause' => 'pause', 'toggle' => empty($s['playing']) ? 'play' : 'pause'][$action]
        ?? (empty($s['playing']) ? 'pause' : 'play');
    if ($action === 'play' || $action === 'toggle') {
        // Free the output device before Apple Music plays again.
        // A paused MPD keeps the device open too.
        if (($action === 'play' || empty($s['playing'])) && mpd_state() !== 'stop') { exec('mpc -q stop >/dev/null 2>&1'); }
    }
    echo json_encode(['ok' => push_command($action), 'state' => $result]);
    exit;
}

if ($cmd === 'volume') {
    if ($post) {
        $level = filter_var($_GET['level'] ?? '', FILTER_VALIDATE_INT,
            ['options' => ['min_range' => 0, 'max_range' => 100]]);
        if ($level === false) {
            http_response_code(400);
            echo json_encode(['error' => 'level must be 0..100']);
            exit;
        }
        if (!volume_state()['bridge']) {
            http_response_code(409);
            echo json_encode(['error' => 'CamillaDSP is not active in moOde']);
            exit;
        }
        // Directly to CamillaDSP, like the PassAirplayVolume project; moOde's
        // own volume knob stays unchanged and is restored when Apple Music closes.
        exec('sudo -n ' . CDSP_VOLUME_UPDATE . ' -l ' . (int)$level . ' 2>&1', $out, $rc);
    }
    echo json_encode(volume_state());
    exit;
}

if ($cmd !== 'status' && !$post) {
    http_response_code(405);
    echo json_encode(['error' => 'use POST']);
    exit;
}

exec('sudo -n /usr/local/bin/moode-applemusic ' . escapeshellarg($cmd) . ' 2>&1', $out, $rc);
$last = trim((string)end($out));
echo json_encode([
    'cmd' => $cmd,
    'ok' => $rc === 0,
    'state' => in_array($last, ['running', 'started'], true) ? 'running' : $last,
    'output' => implode("\n", $out),
]);
