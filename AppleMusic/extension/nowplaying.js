// Runs in the page itself (world MAIN).
// Reports what Apple Music plays to moOde (via content.js) once a second and
// carries out moOde's play/pause/next/previous buttons.
(function () {
    'use strict';
    if (window.top !== window) { return; }

    function musicKit() {
        try { return window.MusicKit && MusicKit.getInstance ? MusicKit.getInstance() : null; } catch (e) { return null; }
    }

    function artwork(item) {
        try {
            var a = item.artwork || (item.attributes && item.attributes.artwork);
            if (!a || !a.url) { return ''; }
            if (MusicKit.formatArtworkURL) { return MusicKit.formatArtworkURL(a, 600, 600); }
            return a.url.replace('{w}', 600).replace('{h}', 600).replace('{f}', 'jpg');
        } catch (e) { return ''; }
    }

    // Where Apple Music is: full-screen player open, on the Home page.
    // A remote's Menu/Back switches between the player and Home, like
    // moOde's Playback and Library views.
    function isHome() { return /\/home\/?$/.test(location.pathname); }
    function view() {
        return { player: !!document.querySelector('.sliding-modal.is-open'), home: isHome() };
    }

    function goHome() {
        if (isHome()) { return; }
        var links = document.querySelectorAll('.navigation a');
        for (var i = links.length - 1; i >= 0; i--) {
            if (/\/home\/?$/.test(links[i].getAttribute('href') || '')) { links[i].click(); return; }
        }
        // Keep the store and the ?l= interface language.
        var lang = new URLSearchParams(location.search).get('l');
        location.href = location.origin + location.pathname.replace(/^(\/[a-z]{2})\/.*$/, '$1/home') +
            (lang ? '?l=' + encodeURIComponent(lang) : '');
    }

    // "home": close the player and show Home. "player": open the player
    // (only when something is queued; otherwise show Home).
    function showHome() {
        var close = document.querySelector('.sliding-modal.is-open .sliding-modal-collapse');
        if (close) {
            close.click();
            setTimeout(function () {
                goHome();
                // Closing returns focus to the mini player, which then shows
                // a focus ring as if it were selected.
                if (document.activeElement && document.activeElement.blur) { document.activeElement.blur(); }
            }, 400);
        } else {
            goHome();
        }
    }

    function showPlayer() {
        var mk = musicKit();
        var open = document.querySelector('.mini-player__metadata-button');
        if (mk && mk.nowPlayingItem && open) { open.click(); } else { goHome(); }
    }

    function state() {
        var mk = musicKit();
        if (!mk) { return { ready: false, playing: false, item: null, view: view() }; }
        var it = mk.nowPlayingItem;
        return {
            ready: true,
            authorized: !!mk.isAuthorized,   // signed in (moOde Renderers page)
            view: view(),
            playing: !!mk.isPlaying,
            item: it ? {
                id: it.id || '',
                title: it.title || '',
                artist: it.artistName || '',
                album: it.albumName || '',
                artwork: artwork(it),
                duration: Math.round(mk.currentPlaybackDuration || (it.playbackDuration || 0) / 1000),
                position: Math.round(mk.currentPlaybackTime || 0)
            } : null
        };
    }

    function send() {
        window.postMessage({ source: 'moode-am-page', type: 'state', state: state() }, '*');
    }

    // Open the full-screen player when something new starts that the user
    // chose: a remote click (nav:select) or a tap on the page. Not for the next
    // song of an album, resuming the same song, or the mini player's buttons.
    var INTENT_MS = 12000;   // starting a new album can take several seconds on the Pi
    var intent = null;       // { at, item } when the user chose something
    function itemId() {
        var mk = musicKit();
        return mk && mk.nowPlayingItem ? String(mk.nowPlayingItem.id || '') : '';
    }
    function noteIntent() { intent = { at: Date.now(), item: itemId() }; }

    window.addEventListener('pointerdown', function (ev) {
        if (!ev.isTrusted || !ev.target || !ev.target.closest) { return; }
        if (ev.target.closest('.mini-player, .sliding-modal, #moode-return')) { return; }
        noteIntent();
    }, true);

    function maybeShowPlayer() {
        var mk = musicKit();
        if (!intent || !mk || !mk.isPlaying) { return; }
        if (Date.now() - intent.at > INTENT_MS) { intent = null; return; }
        var id = itemId();
        if (!id || id === intent.item) { return; }   // same song resumed
        intent = null;
        if (!document.querySelector('.sliding-modal.is-open')) {
            var open = document.querySelector('.mini-player__metadata-button');
            if (open) { open.click(); }
        }
    }

    var hooked = false;
    function hook() {
        var mk = musicKit();
        if (hooked || !mk) { return; }
        hooked = true;
        // Report changes at once instead of waiting for the next tick.
        ['playbackStateDidChange', 'nowPlayingItemDidChange'].forEach(function (ev) {
            try {
                mk.addEventListener(ev, function () {
                    setTimeout(send, 50);
                    setTimeout(maybeShowPlayer, 100);
                });
            } catch (e) { /* older MusicKit */ }
        });
    }

    // Sign in/out requested before MusicKit was ready (Apple Music just started).
    var pendingAuth = null;
    function runAuth(action) {
        var mk = musicKit();
        if (!mk) { pendingAuth = action; return; }
        pendingAuth = null;
        var p = null;
        try { p = action === 'signin' ? mk.authorize() : mk.unauthorize(); } catch (e) { /* ignore */ }
        if (p && p.then) { p.then(function () { setTimeout(send, 300); }, function () { setTimeout(send, 300); }); }
    }

    setInterval(function () {
        hook();
        if (pendingAuth) { runAuth(pendingAuth); }
        send();
    }, 1000);

    window.addEventListener('message', function (ev) {
        var d = ev.data;
        if (ev.source !== window || !d || d.source !== 'moode-am-ext' || d.type !== 'command') { return; }
        if (typeof d.action === 'string' && /^nav:.*select/.test(d.action)) { noteIntent(); return; }
        // Apple's own sign-in window (no password passes through moOde).
        if (d.action === 'signin' || d.action === 'signout') { runAuth(d.action); return; }
        if (d.action === 'home') { showHome(); setTimeout(send, 900); return; }
        if (d.action === 'player') { showPlayer(); setTimeout(send, 900); return; }
        var mk = musicKit();
        if (!mk) { return; }
        var p = null;
        try {
            switch (d.action) {
                case 'play': p = mk.play(); break;
                case 'pause': p = mk.pause(); break;
                case 'toggle': p = mk.isPlaying ? mk.pause() : mk.play(); break;
                case 'next': p = mk.skipToNextItem(); break;
                case 'prev':
                    // Like a CD player: restart the song unless it just began.
                    p = (mk.currentPlaybackTime || 0) > 3 ? mk.seekToTime(0) : mk.skipToPreviousItem();
                    break;
            }
        } catch (e) { /* nothing queued */ }
        if (p && p.catch) { p.catch(function () {}); }
        setTimeout(send, 300);
    });
}());
