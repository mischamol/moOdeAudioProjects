// Runs in the page itself (world MAIN).
// Apple Music Web keeps pages you left in memory: after browsing for a while
// it holds 10-15x more DOM nodes than it shows (measured 182 000 vs 900) and
// gets slower and slower on the Pi. A reload frees all of it, so reload when
// nobody uses Apple Music and nothing plays.
(function () {
    'use strict';
    if (window.top !== window) { return; }
    var CHECK_MS = 60 * 1000;
    var IDLE_MS = 10 * 60 * 1000;          // no touch, key or wheel input
    var PAUSED_MS = 30 * 60 * 1000;        // a paused song is kept this long
    var MIN_HEAP = 60 * 1000 * 1000;       // fresh page: ~30-45 MB
    var MAX_AGE = 2 * 60 * 60 * 1000;      // reload anyway after this, when idle

    var started = Date.now();
    var lastUser = started;
    var lastPlaying = started;
    ['pointerdown', 'touchstart', 'keydown', 'wheel'].forEach(function (type) {
        window.addEventListener(type, function () { lastUser = Date.now(); }, { capture: true, passive: true });
    });

    function musicKit() {
        try { return window.MusicKit && MusicKit.getInstance ? MusicKit.getInstance() : null; } catch (e) { return null; }
    }

    setInterval(function () {
        var now = Date.now();
        var mk = musicKit();
        if (!mk) { return; }
        if (mk.isPlaying) { lastPlaying = now; return; }
        if (now - lastUser < IDLE_MS) { return; }
        var queued = !!mk.nowPlayingItem;
        if (queued && now - lastPlaying < PAUSED_MS) { return; }
        var heap = performance.memory ? performance.memory.usedJSHeapSize : 0;
        if (heap < MIN_HEAP && now - started < MAX_AGE) { return; }
        location.reload();
    }, CHECK_MS);
}());
