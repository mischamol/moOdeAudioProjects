<?php
/*
 * Apple Music bridge for moOde (AppleMusic project).
 * POST applemusic.php?cmd=open|close|toggle   open/close Apple Music on the local display
 * GET  applemusic.php?cmd=status              running|stopped
 * GET  applemusic.php?cmd=volume              CamillaDSP volume for the Apple Music slider
 * POST applemusic.php?cmd=volume&level=0..100 set CamillaDSP volume directly
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

$cmd = $_GET['cmd'] ?? '';
$allowed = ['open', 'close', 'toggle', 'status', 'volume'];
if (!in_array($cmd, $allowed, true)) {
    http_response_code(400);
    echo json_encode(['error' => 'unknown command']);
    exit;
}
$post = $_SERVER['REQUEST_METHOD'] === 'POST';

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
    'state' => in_array($last, ['running', 'started'], true) ? 'running' : ($last === 'stopped' ? 'stopped' : $last),
    'output' => implode("\n", $out),
]);
