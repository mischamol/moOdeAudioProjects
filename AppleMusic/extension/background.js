// Talks to moOde's web server on the Pi itself (applemusic.php).
var ENDPOINT = 'http://localhost/applemusic.php';

function request(query, opts) {
    return fetch(ENDPOINT + '?' + query, Object.assign({ cache: 'no-store' }, opts || {}))
        .then(function (r) { return r.json(); });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg) { return false; }
    if (msg.type === 'moode-close') {
        // "‹ moOde": hide Apple Music (music keeps playing). If that fails,
        // close every window, which ends this Chromium instance.
        request('cmd=hide', { method: 'POST' })
            .then(function (res) { if (!res || res.state !== 'hidden') { throw new Error('hide failed'); } })
            .catch(function () {
                chrome.windows.getAll(function (windows) {
                    windows.forEach(function (w) { chrome.windows.remove(w.id); });
                });
            });
        return false;
    }
    if (msg.type === 'moode-osk') {
        // moOde's "Popup keyboard" setting (osk.js).
        request('cmd=settings').then(sendResponse).catch(function () { sendResponse(null); });
        return true;
    }
    if (msg.type === 'moode-theme') {
        request('cmd=theme').then(sendResponse).catch(function () { sendResponse(null); });
        return true;
    }
    if (msg.type === 'siri-overlay') {
        // SiriRemote's on-screen feedback (long-poll on the Pi itself).
        fetch('http://127.0.0.1:8765/overlay?since=' + (msg.since | 0), { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(sendResponse)
            .catch(function () { sendResponse(null); });
        return true;
    }
    if (msg.type === 'moode-sync') {
        request('cmd=sync&wait=1', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(msg.state || {}) })
            .then(sendResponse)
            .catch(function () { sendResponse(null); });
        return true;
    }
    if (msg.type === 'moode-set-volume') {
        request('cmd=volume&level=' + encodeURIComponent(msg.level | 0), { method: 'POST' })
            .then(sendResponse)
            .catch(function () { sendResponse(null); });
        return true;
    }
    return false;
});
