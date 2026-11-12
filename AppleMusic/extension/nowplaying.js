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

    function state() {
        var mk = musicKit();
        if (!mk) { return { ready: false, playing: false, item: null }; }
        var it = mk.nowPlayingItem;
        return {
            ready: true,
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

    var hooked = false;
    function hook() {
        var mk = musicKit();
        if (hooked || !mk) { return; }
        hooked = true;
        // Report changes at once instead of waiting for the next tick.
        ['playbackStateDidChange', 'nowPlayingItemDidChange'].forEach(function (ev) {
            try { mk.addEventListener(ev, function () { setTimeout(send, 50); }); } catch (e) { /* older MusicKit */ }
        });
    }

    setInterval(function () { hook(); send(); }, 1000);

    window.addEventListener('message', function (ev) {
        var d = ev.data;
        if (ev.source !== window || !d || d.source !== 'moode-am-ext' || d.type !== 'command') { return; }
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
