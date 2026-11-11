// Runs in the page itself (world MAIN).
// Couples Apple Music's volume slider to moOde's volume (CamillaDSP):
// Chromium always plays at full level and the slider sets moOde's volume
// instead; moOde volume changes (knob, remote) move the slider.
(function () {
    'use strict';
    var desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
    var wanted = new WeakMap();
    var bridge = false;
    var lastUser = 0;
    var sendTimer = null;

    // Only forward changes the user makes; Apple Music restores its own saved
    // volume on start-up, which must never reach CamillaDSP.
    ['pointerdown', 'pointermove', 'touchstart', 'touchmove', 'keydown', 'wheel'].forEach(function (type) {
        window.addEventListener(type, function () { lastUser = Date.now(); }, { capture: true, passive: true });
    });

    Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
        configurable: true,
        enumerable: desc.enumerable,
        get: function () {
            if (bridge && this instanceof HTMLAudioElement && wanted.has(this)) { return wanted.get(this); }
            return desc.get.call(this);
        },
        set: function (v) {
            if (!bridge || !(this instanceof HTMLAudioElement)) { desc.set.call(this, v); return; }
            var previous = wanted.has(this) ? wanted.get(this) : desc.get.call(this);
            wanted.set(this, v);
            desc.set.call(this, 1);
            // The element itself stays at 1, so the browser fires no
            // "volumechange"; Apple Music's slider listens for it.
            if (previous !== v && !dispatching) {
                dispatching = true;
                try { this.dispatchEvent(new Event('volumechange')); } finally { dispatching = false; }
            }
            userChange(v);
        }
    });
    var dispatching = false;

    var lastSent = null;
    function userChange(v) {
        if (!bridge || Date.now() - lastUser > 1500) { return; }
        var level = Math.round(Math.max(0, Math.min(1, v)) * 100);
        clearTimeout(sendTimer);
        sendTimer = setTimeout(function () {
            if (level === lastSent) { return; }
            lastSent = level;
            window.postMessage({ source: 'moode-am-page', type: 'set-volume', level: level }, '*');
        }, 120);
    }

    // Also follow MusicKit's own volume, which exists before any audio
    // element does (nothing playing yet).
    function hookMusicKit(mk) {
        if (mk.__moodeVolumeHooked) { return; }
        var proto = mk, d = null;
        while (proto && !(d = Object.getOwnPropertyDescriptor(proto, 'volume'))) { proto = Object.getPrototypeOf(proto); }
        if (d && d.set && d.get) {
            Object.defineProperty(mk, 'volume', {
                configurable: true,
                get: function () { return d.get.call(this); },
                set: function (v) { d.set.call(this, v); userChange(v); }
            });
        }
        try { mk.addEventListener('playbackVolumeDidChange', function () { userChange(mk.volume); }); } catch (e) { /* older MusicKit */ }
        mk.__moodeVolumeHooked = true;
    }

    function musicKit() {
        try { return window.MusicKit && MusicKit.getInstance ? MusicKit.getInstance() : null; } catch (e) { return null; }
    }

    window.addEventListener('message', function (ev) {
        var d = ev.data;
        if (ev.source !== window || !d || d.source !== 'moode-am-ext' || d.type !== 'volume-state') { return; }
        if (!d.bridge) { return; }
        var mk = musicKit();
        if (!mk) { return; }
        hookMusicKit(mk);
        var first = !bridge;
        bridge = true;
        // Don't fight the user while they move the slider.
        if (!first && Date.now() - lastUser < 2500) { return; }
        lastSent = d.level;
        var target = d.level / 100;
        if (first || Math.abs(mk.volume - target) > 0.011) {
            mk.volume = target;
        }
    });
}());
