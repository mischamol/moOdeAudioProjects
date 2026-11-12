// SiriRemote on-screen feedback (volume, play/pause, next, battery, ...)
// inside Apple Music. The SiriRemote daemon publishes it on a loopback
// long-poll endpoint; moOde's own page shows it underneath, so without this
// copy it stays hidden while Apple Music covers the screen. Rendering follows
// SiriRemote/moode-navigation/siri-remote-navigation.js.
(function () {
    'use strict';
    if (window.top !== window) { return; }

    var version = -1;
    var element = null;
    var failures = 0;

    function make(className, text) {
        var el = document.createElement('div');
        el.className = className;
        if (text !== undefined) { el.textContent = text; }
        return el;
    }

    // The full-screen player is a modal <dialog> in the browser's top layer,
    // above any z-index; the overlay must then live inside that dialog.
    function host() {
        var open = document.querySelectorAll('dialog[open]');
        return open.length ? open[open.length - 1] : document.documentElement;
    }

    function ensure() {
        if (element && element.isConnected) {
            var h = host();
            if (element.parentNode !== h) { h.appendChild(element); }
            return element;
        }
        element = make('');
        element.id = 'siri-browser-overlay';
        element.setAttribute('aria-hidden', 'true');
        var glass = make('siri-overlay-glass');
        glass.appendChild(make('siri-overlay-lens'));
        glass.appendChild(make('siri-overlay-content'));
        element.appendChild(glass);
        host().appendChild(element);
        return element;
    }

    function visible(el) {
        var r = el.getBoundingClientRect();
        var cs = getComputedStyle(el);
        return r.width > 80 && r.height > 80 && cs.display !== 'none' && cs.visibility !== 'hidden';
    }

    // Centre on the artwork of the full-screen player, as moOde does on its
    // cover; elsewhere on the same spot as in moOde's Playback view.
    function cover() {
        var sheet = document.querySelector('.sliding-modal.is-open');
        if (!sheet) { return null; }
        var best = null, area = 0;
        sheet.querySelectorAll('picture img, img').forEach(function (img) {
            var r = img.getBoundingClientRect();
            if (r.width * r.height > area && visible(img)) { best = img; area = r.width * r.height; }
        });
        return best;
    }

    function position() {
        var el = ensure();
        var img = cover();
        var size, cx, cy;
        if (img) {
            var r = img.getBoundingClientRect();
            size = Math.min(r.width, r.height) * 0.88;
            cx = r.left + r.width / 2;
            cy = r.top + r.height / 2;
        } else {
            size = Math.min(window.innerWidth, window.innerHeight) * 0.68;
            cx = window.innerWidth / 2;
            cy = window.innerHeight * 0.29375;
        }
        size = Math.max(180, Math.min(size, window.innerWidth * 0.94));
        var left = cx - size / 2, top = cy - size / 2;
        el.style.width = size + 'px';
        el.style.height = size + 'px';
        el.style.left = left + 'px';
        el.style.top = top + 'px';
        // Inside a transformed dialog "fixed" is relative to the dialog.
        var actual = el.getBoundingClientRect();
        if (Math.abs(actual.left - left) > 0.5 || Math.abs(actual.top - top) > 0.5) {
            el.style.left = (2 * left - actual.left) + 'px';
            el.style.top = (2 * top - actual.top) + 'px';
        }
        var lens = el.querySelector('.siri-overlay-lens');
        var url = img && (img.currentSrc || img.src);
        if (lens && url) {
            var ir = img.getBoundingClientRect();
            lens.style.backgroundImage = 'url(' + JSON.stringify(url) + ')';
            lens.style.backgroundSize = ir.width + 'px ' + ir.height + 'px';
            lens.style.backgroundPosition = (ir.left - left) + 'px ' + (ir.top - top) + 'px';
        } else if (lens) {
            lens.style.backgroundImage = 'none';
        }
    }

    function glyph(kind) {
        var g = make('siri-glyph siri-' + kind);
        if (kind === 'next' || kind === 'previous') {
            g.appendChild(make('triangle one'));
            g.appendChild(make('triangle two'));
            g.appendChild(make('bar'));
        }
        return g;
    }

    function power(number) {
        var p = make('siri-power');
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('aria-hidden', 'true');
        ['M31 21a38 38 0 1 0 38 0', 'M50 8v39'].forEach(function (d) {
            var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', 'currentColor');
            path.setAttribute('stroke-width', '8');
            path.setAttribute('stroke-linecap', 'round');
            svg.appendChild(path);
        });
        p.appendChild(svg);
        var digit = document.createElement('span');
        digit.textContent = number;
        p.appendChild(digit);
        return p;
    }

    var RENDERERS = {
        'AIRPLAY': 'AirPlay', 'BLUETOOTH': 'Bluetooth', 'SPOTIFY': 'Spotify', 'DEEZER': 'Deezer',
        'SQUEEZELITE': 'Squeezelite', 'PLEXAMP': 'Plexamp', 'ROONBRIDGE': 'RoonBridge',
        'AUDIO INPUT': 'Audio Input', 'MULTIROOM RECEIVER': 'Multiroom\nReceiver', 'RENDERER': 'Renderer'
    };

    function render(text) {
        var content = ensure().querySelector('.siri-overlay-content');
        content.replaceChildren();
        var t = String(text || '').trim().toUpperCase();
        if (t === 'PLAY' || t === 'PAUSE' || t === 'NEXT' || t === 'PREVIOUS') {
            content.appendChild(glyph(t.toLowerCase()));
        } else if (t.indexOf('VOLUME:') === 0) {
            content.appendChild(make('siri-overlay-label', 'Volume'));
            content.appendChild(make('siri-overlay-value', t.slice(7)));
        } else if (t.indexOf('BATTERY:') === 0) {
            var battery = make('siri-battery');
            battery.appendChild(make('siri-battery-value', t.slice(8)));
            content.appendChild(battery);
        } else if (t.indexOf('DISABLED:') === 0) {
            content.appendChild(make('siri-overlay-label', 'Disabled'));
            var r = make('siri-overlay-renderer', RENDERERS[t.slice(9)] || t.slice(9));
            r.style.whiteSpace = 'pre-line';
            content.appendChild(r);
        } else if (t.indexOf('SHUTDOWN:') === 0) {
            content.appendChild(power(t.slice(9)));
        } else if (t === 'SHUTTING DOWN') {
            content.appendChild(power('0'));
        } else {
            content.appendChild(make('siri-overlay-renderer', t));
        }
        position();
    }

    function apply(state) {
        var el = ensure();
        if (!state.visible) { el.classList.remove('siri-overlay-visible'); return; }
        render(state.text);
        el.classList.add('siri-overlay-visible');
    }

    function poll() {
        chrome.runtime.sendMessage({ type: 'siri-overlay', since: version }, function (state) {
            if (chrome.runtime.lastError || !state || typeof state.version !== 'number') {
                // SiriRemote not installed or restarting: retry, slowing down.
                failures = Math.min(failures + 1, 20);
                setTimeout(poll, failures < 5 ? 150 : 5000);
                return;
            }
            failures = 0;
            if (state.version !== version) {
                // The first answer only tells the current version.
                if (version !== -1 || state.visible) { apply(state); }
                version = state.version;
            }
            poll();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', poll);
    } else {
        poll();
    }
}());
