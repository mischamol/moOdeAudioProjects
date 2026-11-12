(function () {
    'use strict';
    if (window.top !== window) { return; }

    // "‹ moOde" button: closes Apple Music and returns to moOde.
    function addButton() {
        if (document.getElementById('moode-return')) { return; }
        var btn = document.createElement('button');
        btn.id = 'moode-return';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Terug naar moOde');
        btn.textContent = '‹ moOde';
        btn.addEventListener('click', function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            // Apple Music is hidden, not closed: the button works again
            // when it is shown next time.
            btn.disabled = true;
            setTimeout(function () { btn.disabled = false; }, 2000);
            chrome.runtime.sendMessage({ type: 'moode-close' });
        });
        document.documentElement.appendChild(btn);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addButton);
    } else {
        addButton();
    }

    // Full-screen player state. "moode-player-open" on <html> lets the
    // browser skip the page underneath (content.css); "‹ moOde" is hidden
    // while the player is open. A cheap timer is used instead of observing
    // the whole document; clicks on the open/close buttons act at once.
    var root = document.documentElement;
    var openedAt = 0;
    function setPlayerOpen(open) {
        root.classList.toggle('moode-player-open', open);
        var btn = document.getElementById('moode-return');
        if (btn) { btn.classList.toggle('moode-hidden', open); }
    }
    function waitForClose() {
        if (document.querySelector('.sliding-modal')) { requestAnimationFrame(waitForClose); return; }
        setPlayerOpen(false);
    }
    document.addEventListener('click', function (ev) {
        var t = ev.target;
        if (!t || !t.closest) { return; }
        if (t.closest('.mini-player__metadata-button')) {
            openedAt = Date.now();
            setPlayerOpen(true);
        } else if (t.closest('.sliding-modal-collapse')) {
            openedAt = 0;
            requestAnimationFrame(waitForClose);
        }
    }, true);
    // Time-synced lyrics blur every line that is not sung (filter: blur(2px)
    // with a transition). On the Pi that took ~110 % CPU plus ~70 % in the GPU
    // process and made the lyrics stutter; without the blur: 60 fps, ~35 %.
    // The lyrics live in nested shadow DOMs, out of reach of content.css.
    var LYRICS_CSS = 'amp-lyrics-display-synced-line, amp-lyrics-display-instrumental-line ' +
        '{ filter: none !important; transition: none !important; }';
    function lightLyrics() {
        var lyrics = document.querySelector('.sliding-modal amp-lyrics');
        var synced = lyrics && lyrics.shadowRoot &&
            lyrics.shadowRoot.querySelector('amp-lyrics-display-time-synced');
        var root = synced && synced.shadowRoot;
        if (root && !root.getElementById('moode-light-lyrics')) {
            var style = document.createElement('style');
            style.id = 'moode-light-lyrics';
            style.textContent = LYRICS_CSS;
            root.appendChild(style);
        }
    }

    setInterval(function () {
        var open = !!document.querySelector('.sliding-modal.is-open');
        if (open) { lightLyrics(); }
        // Right after a click the player may still be on its way.
        if (!open && Date.now() - openedAt < 1500) { return; }
        if (open !== root.classList.contains('moode-player-open')) { setPlayerOpen(open); }
    }, 400);

    // Relay between the page (nowplaying.js, volume.js) and moOde: the page
    // reports what plays once a second; moOde answers with its volume and
    // any buttons pressed in the moOde interface.
    function pushState(state) {
        if (state && typeof state.level === 'number') {
            window.postMessage({ source: 'moode-am-ext', type: 'volume-state',
                bridge: !!state.bridge, level: state.level }, '*');
        }
    }
    // When MPD takes over, moOde restarts Chromium's audio process to free
    // the device; Apple Music then shows "Er is een fout opgetreden". Close it.
    function dismissError() {
        [500, 1500, 3000, 6000].forEach(function (ms) {
            setTimeout(function () {
                var ok = document.querySelector('[data-testid="error-modal"] button');
                if (ok) { ok.click(); }
            }, ms);
        });
    }
    var syncing = false;
    var pending = null;
    function sync(state) {
        if (syncing) { pending = state; return; }
        syncing = true;
        chrome.runtime.sendMessage({ type: 'moode-sync', state: state }, function (res) {
            syncing = false;
            if (res) {
                pushState(res.volume);
                (res.commands || []).forEach(function (action) {
                    if (action === 'dismiss-error') { dismissError(); return; }
                    if (action === 'recover-audio') {
                        // Chromium's audio was restarted: once Apple Music has
                        // noticed (error message), play on. play is a no-op
                        // when it already plays.
                        dismissError();
                        [1500, 3500].forEach(function (ms) {
                            setTimeout(function () {
                                window.postMessage({ source: 'moode-am-ext', type: 'command', action: 'play' }, '*');
                            }, ms);
                        });
                        return;
                    }
                    window.postMessage({ source: 'moode-am-ext', type: 'command', action: action }, '*');
                });
            }
            if (pending) { var next = pending; pending = null; sync(next); }
        });
    }
    window.addEventListener('message', function (ev) {
        var d = ev.data;
        if (ev.source !== window || !d || d.source !== 'moode-am-page') { return; }
        if (d.type === 'state') {
            sync(d.state);
        } else if (d.type === 'set-volume') {
            chrome.runtime.sendMessage({ type: 'moode-set-volume', level: d.level }, pushState);
        }
    });

    // Swipe down closes the full-screen player, as in the iOS/Android app.
    // Apple Music only enables this gesture on phones, not on the Pi.
    var MIN_DISTANCE = 90;
    var MAX_TIME = 900;
    var start = null;

    function openSheet() { return document.querySelector('.sliding-modal.is-open'); }

    function scrolledAncestor(el, stop) {
        for (; el && el !== stop; el = el.parentElement) {
            if (el.scrollHeight > el.clientHeight + 2 && el.scrollTop > 0) {
                var oy = getComputedStyle(el).overflowY;
                if (oy === 'auto' || oy === 'scroll') { return true; }
            }
        }
        return false;
    }

    function isControl(el) {
        return !!(el && el.closest && el.closest(
            'input, [role="slider"], [class*="slider"], [class*="scrubber"], [class*="progress"], [class*="volume"]'));
    }

    document.addEventListener('pointerdown', function (ev) {
        var sheet = openSheet();
        start = null;
        if (!sheet || !ev.isPrimary || !sheet.contains(ev.target) || isControl(ev.target)) { return; }
        if (scrolledAncestor(ev.target, sheet)) { return; }
        start = { x: ev.clientX, y: ev.clientY, t: Date.now(), sheet: sheet };
    }, { capture: true, passive: true });

    function finish(ev) {
        if (!start) { return; }
        var s = start;
        start = null;
        var dx = ev.clientX - s.x;
        var dy = ev.clientY - s.y;
        if (dy < MIN_DISTANCE || Math.abs(dx) > dy * 0.6 || Date.now() - s.t > MAX_TIME) { return; }
        var close = s.sheet.querySelector('.sliding-modal-collapse') ||
            document.querySelector('.sliding-modal.is-open .sliding-modal-collapse');
        if (close) { close.click(); }
    }
    document.addEventListener('pointerup', finish, { capture: true, passive: true });
    // When the browser takes over a touch for scrolling it sends
    // pointercancel instead of pointerup; touchend still arrives.
    document.addEventListener('touchend', function (ev) {
        if (!start || !ev.changedTouches.length) { return; }
        var t = ev.changedTouches[0];
        finish({ clientX: t.clientX, clientY: t.clientY });
    }, { capture: true, passive: true });
    document.addEventListener('touchstart', function (ev) {
        if (start || !ev.touches.length) { return; }
        var sheet = openSheet();
        var t = ev.touches[0];
        if (!sheet || !sheet.contains(ev.target) || isControl(ev.target)) { return; }
        if (scrolledAncestor(ev.target, sheet)) { return; }
        start = { x: t.clientX, y: t.clientY, t: Date.now(), sheet: sheet };
    }, { capture: true, passive: true });
}());
