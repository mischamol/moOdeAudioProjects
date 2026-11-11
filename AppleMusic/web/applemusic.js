/*
 * Apple Music entry for moOde's Library view menu (AppleMusic project).
 * Adds "Apple Music" under Radio / Folder / Tag / Album / Playlist. Choosing it
 * opens Apple Music Web on the Pi's local display; the "moOde" button in Apple
 * Music closes it again.
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

    function isLocalDisplay() {
        return (typeof GLOBAL === 'object' && GLOBAL && GLOBAL.chromium) ||
            /[?&]kiosk=1\b/.test(location.search);
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

    function init() {
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
