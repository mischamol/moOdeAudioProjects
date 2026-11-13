/*
 * Apple Music entry for moOde's Library view menu (AppleMusic project).
 * Adds "Apple Music" under Radio / Folder / Tag / Album / Playlist. Choosing it
 * opens Apple Music Web on the Pi's local display; the "‹ moOde" button in
 * Apple Music hides it again while the music keeps playing. While Apple Music
 * runs, moOde shows it on its renderer screen, like AirPlay.
 */
(function () {
    'use strict';

    var BUTTON_CLASS = 'applemusic-view-btn';

    function toast(text) {
        var el = document.getElementById('applemusic-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'applemusic-toast';
            el.style.cssText = 'position:fixed;left:50%;bottom:5.5rem;transform:translateX(-50%);' +
                'z-index:100000;padding:.6em 1.1em;border-radius:1.4em;font-size:.95rem;' +
                'background:rgba(20,20,20,.85);color:#fff;pointer-events:none;transition:opacity .3s;opacity:0';
            document.body.appendChild(el);
        }
        el.textContent = text;
        el.style.opacity = '1';
        clearTimeout(el._t);
        el._t = setTimeout(function () { el.style.opacity = '0'; }, 2500);
    }

    // The Pi's own display: moOde's kiosk browser opens http://localhost/.
    // (moOde's GLOBAL.chromium also matches any "CrOS" browser, such as a
    // Chromebook or the Raspberry Pi's Chromium on another Pi.)
    function isLocalDisplay() {
        var kiosk = false;
        try { kiosk = localStorage.getItem('kiosk') === '1'; } catch (e) { /* no storage */ }
        return kiosk || /[?&]kiosk=1\b/.test(location.search) ||
            ['localhost', '127.0.0.1', '::1', '[::1]'].indexOf(location.hostname) !== -1;
    }

    function openAppleMusic(ev) {
        if (ev) { ev.preventDefault(); ev.stopPropagation(); }
        // Close the open dropdown menu, like the native view buttons do.
        var open = document.querySelectorAll('.dropdown.open, .btn-group.open');
        for (var i = 0; i < open.length; i++) { open[i].classList.remove('open'); }
        toast('Apple Music openen…');
        fetch('applemusic.php?cmd=open', { method: 'POST', cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (!res.ok) { toast('Apple Music kon niet starten'); return; }
                if (!isLocalDisplay()) { toast('Apple Music staat open op het moOde-scherm'); }
            })
            .catch(function () { toast('Apple Music kon niet starten'); });
    }

    function addButton() {
        if (document.querySelector('.' + BUTTON_CLASS)) { return true; }
        var playlist = document.querySelector('.playlist-view-btn');
        if (!playlist || !playlist.parentNode) { return false; }

        var btn = document.createElement('button');
        btn.setAttribute('aria-label', 'Apple Music');
        btn.className = 'btn ' + BUTTON_CLASS;
        btn.innerHTML = '<i class="fa-brands fa-apple"></i> Apple Music';
        btn.addEventListener('click', openAppleMusic);

        // Keep moOde's separator below the last view entry.
        if (playlist.classList.contains('menu-seperatior')) {
            playlist.classList.remove('menu-seperatior');
            btn.classList.add('menu-seperatior');
        }
        playlist.parentNode.insertBefore(btn, playlist.nextSibling);
        return true;
    }

    // ---- Apple Music as a moOde renderer ------------------------------------
    // While Apple Music runs, moOde shows it like AirPlay or Spotify Connect:
    // moOde's own renderer screen (#inpsrc-indicator) with cover, title and
    // the output format, plus play/pause/next/previous, "show on the Pi
    // screen" and "close" buttons. Phones and computers only: the Pi's own
    // display has Apple Music's player itself, and "‹ moOde" there returns to
    // the normal moOde interface.
    var POLL_MS = 2000;
    var OTHER_RENDERERS = ['btactive', 'aplactive', 'spotactive', 'qbzactive', 'slactive', 'paactive', 'rbactive', 'inpactive'];
    var shown = false;
    var lastMeta = '';

    function canRender() {
        return window.jQuery && typeof inpSrcIndicator === 'function' && typeof updateInpsrcMeta === 'function';
    }

    function otherRendererActive() {
        try {
            return OTHER_RENDERERS.some(function (k) { return SESSION.json[k] === '1'; });
        } catch (e) { return false; }
    }

    function button(action, icon, label) {
        return '<button class="btn renderer-btn applemusic-ctl" data-applemusic="' + action + '" aria-label="' + label +
            '"><i class="' + icon + '"></i></button>';
    }

    function controlsHtml(playing) {
        return '<span id="inpsrc-msg-text">Apple Music Active</span>' +
            button('prev', 'fa-solid fa-sharp fa-backward-step', 'Vorige') +
            button('toggle', 'fa-solid fa-sharp ' + (playing ? 'fa-pause' : 'fa-play'), playing ? 'Pauze' : 'Afspelen') +
            button('next', 'fa-solid fa-sharp fa-forward-step', 'Volgende') +
            button('show', 'fa-solid fa-sharp fa-arrow-up-right-from-square', 'Apple Music tonen') +
            button('close', 'fa-regular fa-sharp fa-xmark', 'Apple Music sluiten');
    }

    function hideRenderer() {
        if (!shown) { return; }
        shown = false;
        lastMeta = '';
        // Leave the screen alone if a real renderer took it over meanwhile.
        if (!otherRendererActive()) { inpSrcIndicator('amactive0', ''); }
    }

    function render(st) {
        if (!canRender()) { return; }
        var item = st && st.app !== 'stopped' ? st.item : null;
        if (!item || otherRendererActive()) { hideRenderer(); return; }

        // moOde may have reset its renderer screen (e.g. after an MPD event).
        var visible = $('#inpsrc-indicator').css('display') === 'block' && $('.applemusic-ctl').length > 0;
        if (!shown || !visible) {
            inpSrcIndicator('amactive1', controlsHtml(st.playing));
            shown = true;
            lastMeta = '';
        }
        // moOde inserts these as HTML.
        var esc = function (s) { return $('<div>').text(s || '').html(); };
        var meta = {
            title: esc(item.title),
            artist: esc(item.artist),
            album: esc(item.album),
            cover_url: item.artwork || (typeof DEFAULT_ALBUM_COVER === 'string' ? DEFAULT_ALBUM_COVER : ''),
            // moOde clears its "… Active" text once metadata is shown; the
            // format badge under the title says which source plays.
            sformat: '<i class="fa-brands fa-apple"></i> Apple Music &middot; AAC 256 kbps',
            oformat: st.oformat || (st.playing ? '' : 'Not playing'),
            duration: Math.round(item.duration || 0),
            playstate: st.playing ? 'Resume' : 'Pause'
        };
        var key = JSON.stringify(meta);
        if (key !== lastMeta) {
            lastMeta = key;
            updateInpsrcMeta('get_applemusicmeta', key);
            // moOde's "refresh metadata" button has nothing to refresh here.
            $('#inpsrc-metadata-refresh').html('');
        }
        var toggle = document.querySelector('.applemusic-ctl[data-applemusic="toggle"] i');
        if (toggle) {
            toggle.className = 'fa-solid fa-sharp ' + (st.playing ? 'fa-pause' : 'fa-play');
            toggle.parentNode.setAttribute('aria-label', st.playing ? 'Pauze' : 'Afspelen');
        }
    }

    var polling = false;
    function poll() {
        if (polling || document.visibilityState === 'hidden') { return; }
        polling = true;
        fetch('applemusic.php?cmd=state', { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(render)
            .catch(function () { /* moOde restarting */ })
            .then(function () { polling = false; });
    }

    function control(action) {
        var url, msg = null;
        if (action === 'show') {
            url = 'applemusic.php?cmd=show';
            if (!isLocalDisplay()) { msg = 'Apple Music staat open op het moOde-scherm'; }
        } else if (action === 'close') {
            url = 'applemusic.php?cmd=close';
            msg = 'Apple Music gesloten';
        } else {
            url = 'applemusic.php?cmd=control&action=' + encodeURIComponent(action);
        }
        fetch(url, { method: 'POST', cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function () {
                if (msg) { toast(msg); }
                if (action === 'close') { render(null); }
                setTimeout(poll, 700);
            })
            .catch(function () { toast('Apple Music reageert niet'); });
    }

    document.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('.applemusic-ctl') : null;
        if (!btn) { return; }
        ev.preventDefault();
        ev.stopPropagation();
        control(btn.getAttribute('data-applemusic'));
    }, true);

    function init() {
        if (!isLocalDisplay()) {
            setInterval(poll, POLL_MS);
            setTimeout(poll, 500);
            document.addEventListener('visibilitychange', poll);
        }
        if (addButton()) { return; }
        var tries = 0;
        var timer = setInterval(function () {
            if (addButton() || ++tries > 40) { clearInterval(timer); }
        }, 250);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
