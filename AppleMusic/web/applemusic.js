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
        toast('Opening Apple Music…');
        fetch('applemusic.php?cmd=open', { method: 'POST', cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (!res.ok) { toast('Apple Music could not start'); return; }
                if (!isLocalDisplay()) { toast('Apple Music is open on the moOde display'); }
            })
            .catch(function () { toast('Apple Music could not start'); });
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
    // the output format, plus play/pause/next/previous and "close" buttons. Phones and computers only: the Pi's own
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
            button('prev', 'fa-solid fa-sharp fa-backward-step', 'Previous') +
            button('toggle', 'fa-solid fa-sharp ' + (playing ? 'fa-pause' : 'fa-play'), playing ? 'Pause' : 'Play') +
            button('next', 'fa-solid fa-sharp fa-forward-step', 'Next') +
            button('close', 'fa-regular fa-sharp fa-xmark', 'Close Apple Music');
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
            toggle.parentNode.setAttribute('aria-label', st.playing ? 'Pause' : 'Play');
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
            if (!isLocalDisplay()) { msg = 'Apple Music is open on the moOde display'; }
        } else if (action === 'close') {
            url = 'applemusic.php?cmd=close';
            msg = 'Apple Music closed';
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
            .catch(function () { toast('Apple Music does not respond'); });
    }

    document.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('.applemusic-ctl') : null;
        if (!btn) { return; }
        ev.preventDefault();
        ev.stopPropagation();
        control(btn.getAttribute('data-applemusic'));
    }, true);

    // ---- Configure > Renderers: "Apple Music Webplayer" -----------------------
    // Service on/off (off: closed, and no Library menu entry), sign-in state,
    // and buttons to sign in or out in Apple's own window on the Pi's screen.
    function api(cmd, post) {
        return fetch('applemusic.php?cmd=' + cmd, { method: post ? 'POST' : 'GET', cache: 'no-store' })
            .then(function (r) { return r.json(); });
    }

    function rendererBlock() {
        var div = document.createElement('div');
        div.className = 'control-group';
        div.id = 'applemusic-renderer';
        div.innerHTML =
            '<legend>Apple Music Webplayer</legend>' +
            '<label class="control-label">Service</label>' +
            '<div class="controls">' +
            // moOde's toggle look; its state is the "toggle-off" class, which
            // moOde's own script only sets for blocks present at page load.
            '  <div class="toggle" id="applemusic-toggle" role="switch" tabindex="0">' +
            '    <label class="toggle-radio">ON </label>' +
            '    <label class="toggle-radio">OFF</label>' +
            '  </div>' +
            '  <span class="config-help-static">Apple Music Web player on the local display. Requires an ' +
            '  Apple Music subscription and a local display.</span>' +
            '</div>' +
            '<label class="control-label">Quality</label>' +
            '<div class="controls"><span style="display:inline-block;line-height:1.4;padding-top:4px;' +
            'margin-bottom:var(--config-ctl-margin-bottom, 1em)">AAC 256 kbps only (no lossless in Apple Music Web)</span></div>' +
            '<label class="control-label">Account</label>' +
            '<div class="controls"><span id="applemusic-account" style="display:inline-block;line-height:1.4;padding-top:4px;' +
            'margin-bottom:var(--config-ctl-margin-bottom, 1em)">…</span></div>' +
            '<div class="controls">' +
            '  <button type="button" class="btn btn-medium btn-primary config-btn" id="applemusic-signin">Sign in</button>' +
            '  <span class="config-btn-after">Opens Apple\'s sign-in window on the moOde display. Type with a ' +
            '  USB keyboard on the Pi. Your password does not pass through moOde.</span>' +
            '</div>' +
            '<div class="controls">' +
            '  <button type="button" class="btn btn-medium btn-primary config-btn" id="applemusic-signout">Sign out</button>' +
            '  <span class="config-btn-after">Apple Music account on this player</span>' +
            '</div>';
        return div;
    }

    function showSettings(s) {
        var on = !!s.enabled;
        var toggle = document.getElementById('applemusic-toggle');
        toggle.classList.toggle('toggle-off', !on);
        toggle.setAttribute('aria-checked', on ? 'true' : 'false');
        var account = s.signed_in === true ? 'Signed in' :
            s.signed_in === false ? 'Not signed in' : 'Unknown (shown once Apple Music has been opened)';
        document.getElementById('applemusic-account').textContent = account;
        document.getElementById('applemusic-signin').disabled = !on || s.signed_in === true;
        document.getElementById('applemusic-signout').disabled = !on || s.signed_in === false;
    }

    function refreshSettings() { return api('settings').then(showSettings).catch(function () { /* moOde busy */ }); }

    // moOde's own confirmation dialog (as for Spotify's "Clear"); the
    // browser's confirm() lands partly off screen on the local display.
    function confirmSignOut() {
        var modal = document.getElementById('applemusic-signout-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'applemusic-signout-modal';
            modal.className = 'modal hide';
            modal.setAttribute('tabindex', '-1');
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-hidden', 'true');
            modal.innerHTML =
                '<div class="modal-header"><button aria-label="Close" type="button" class="close" data-dismiss="modal">&times;</button>' +
                '<h3>Sign out of Apple Music?</h3></div>' +
                '<div class="modal-body"><p>This player will no longer play Apple Music until you sign in again.</p></div>' +
                '<div class="modal-footer">' +
                '<button type="button" class="btn" data-dismiss="modal">Cancel</button>' +
                '<button type="button" class="btn btn-primary" id="applemusic-signout-yes">Yes</button></div>';
            document.body.appendChild(modal);
            modal.querySelector('#applemusic-signout-yes').addEventListener('click', function () {
                window.jQuery(modal).modal('hide');
                document.getElementById('applemusic-signout').disabled = true;
                api('signout', true)
                    .then(function (res) { toast(res && res.ok ? 'Signed out' : 'Apple Music does not respond'); })
                    .catch(function () { toast('Apple Music does not respond'); })
                    .then(function () { setTimeout(refreshSettings, 4000); });
            });
        }
        window.jQuery(modal).modal('show');
    }

    function initRenderersPage() {
        var legends = document.querySelectorAll('.container legend');
        if (!legends.length || document.getElementById('applemusic-renderer')) { return false; }
        // After Qobuz Connect (the streaming services), else after the last renderer.
        var after = null;
        for (var i = 0; i < legends.length; i++) {
            if (/Qobuz/i.test(legends[i].textContent)) { after = legends[i].closest('.control-group'); }
        }
        if (!after) { after = legends[legends.length - 1].closest('.control-group'); }
        if (!after) { return false; }
        var block = rendererBlock();
        after.parentNode.insertBefore(block, after.nextSibling);

        document.getElementById('applemusic-toggle').addEventListener('click', function (ev) {
            ev.preventDefault();
            var toggle = ev.currentTarget;
            var on = toggle.classList.contains('toggle-off');   // switch to the other state
            toggle.classList.toggle('toggle-off', !on);
            api(on ? 'enable' : 'disable', true)
                .then(function () { toast(on ? 'Apple Music Webplayer on' : 'Apple Music Webplayer off'); return refreshSettings(); })
                .catch(function () { toast('Could not change the setting'); });
        });
        block.addEventListener('click', function (ev) {
            var b = ev.target.closest('button');
            if (!b || !block.contains(b)) { return; }
            ev.preventDefault();
            var cmd = b.id === 'applemusic-signin' ? 'signin' : b.id === 'applemusic-signout' ? 'signout' : null;
            if (!cmd) { return; }
            if (cmd === 'signout') { confirmSignOut(); return; }
            b.disabled = true;
            if (cmd === 'signin') { toast('Apple sign-in opens on the moOde display'); }
            api(cmd, true)
                .then(function (res) { if (res && res.ok === false && res.error) { toast(res.error); } })
                .catch(function () { toast('Apple Music does not respond'); })
                .then(function () { setTimeout(refreshSettings, 4000); });
        });
        refreshSettings();
        setInterval(refreshSettings, 5000);
        return true;
    }

    function init() {
        if (/ren-config\.php$/.test(location.pathname)) {
            if (!initRenderersPage()) {
                var t = 0, iv = setInterval(function () { if (initRenderersPage() || ++t > 40) { clearInterval(iv); } }, 250);
            }
            return;
        }
        if (!document.querySelector('#viewswitch, #playback-panel')) { return; }   // other configuration pages
        if (!isLocalDisplay()) {
            setInterval(poll, POLL_MS);
            setTimeout(poll, 500);
            document.addEventListener('visibilitychange', poll);
        }
        // The Library menu entry only while the service is on.
        api('settings').then(function (s) {
            if (!s.enabled) { return; }
            if (addButton()) { return; }
            var tries = 0;
            var timer = setInterval(function () {
                if (addButton() || ++tries > 40) { clearInterval(timer); }
            }, 250);
        }).catch(function () { addButton(); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
