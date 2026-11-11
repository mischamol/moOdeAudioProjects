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
            btn.disabled = true;
            chrome.runtime.sendMessage({ type: 'moode-close' });
        });
        document.documentElement.appendChild(btn);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addButton);
    } else {
        addButton();
    }

    // Hide "‹ moOde" while the full-screen player is open. A cheap timer is
    // used instead of observing the whole document.
    setInterval(function () {
        var btn = document.getElementById('moode-return');
        if (btn) { btn.classList.toggle('moode-hidden', !!document.querySelector('.sliding-modal.is-open')); }
    }, 400);

    // Volume bridge: relay between the page (volume.js) and the extension.
    function pushState(state) {
        if (state && typeof state.level === 'number') {
            window.postMessage({ source: 'moode-am-ext', type: 'volume-state',
                bridge: !!state.bridge, level: state.level }, '*');
        }
    }
    function pollVolume() {
        if (document.hidden) { return; }
        chrome.runtime.sendMessage({ type: 'moode-get-volume' }, pushState);
    }
    window.addEventListener('message', function (ev) {
        var d = ev.data;
        if (ev.source !== window || !d || d.source !== 'moode-am-page' || d.type !== 'set-volume') { return; }
        chrome.runtime.sendMessage({ type: 'moode-set-volume', level: d.level }, pushState);
    });
    setInterval(pollVolume, 2000);
    setTimeout(pollVolume, 1500);

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
