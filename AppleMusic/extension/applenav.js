// Siri Remote navigation inside Apple Music, like moOde's Library: touchpad
// swipes move a focus frame over Apple Music's tiles, cards, buttons and
// songs (scrolling along, also through the horizontal shelves); a touchpad
// click plays the focused album, playlist, station or song at once (its own
// Play button; touch the screen to open an album page instead). The
// SiriRemote daemon sends the moves as "nav:" commands through
// applemusic.php (see content.js).
(function () {
    'use strict';
    if (window.top !== window) { return; }

    var FOCUS = 'moode-nav-focus';
    // What can be focused, and what a click on it activates, in order of
    // preference: the item's Play button where it has one, otherwise its link.
    var PLAY = 'button[data-testid="play-button"]';
    var TARGETS = [
        ['[data-testid="product-lockup"]', [PLAY, '[data-testid="product-lockup-link"]']],
        ['[data-testid="powerswoosh"]', [PLAY, 'a[data-testid="click-action"]', '[data-testid="click-action"]']],
        ['[data-testid="button-action"]', ['button', 'a']],
        ['[data-testid="track-list-item"]', ['[data-testid="track-play-button"] button', PLAY]],
        ['[data-testid="header-title"] button', []]
    ];
    var SELECTOR = TARGETS.map(function (t) { return t[0]; }).join(', ');

    var style = document.createElement('style');
    // moOde's accent colour (theme.js); album pages set their own --keyColor.
    style.textContent =
        '.' + FOCUS + ' { outline: 4px solid var(--moode-accent, var(--keyColor, #d35400)) !important;' +
        ' outline-offset: 3px; border-radius: 10px; }';
    (document.head || document.documentElement).appendChild(style);

    var current = null;
    var queued = [];
    var scheduled = false;

    function root() { return document.getElementById('scrollable-page') || document.body; }

    // The page as rows of items, in document order: a shelf (horizontal row
    // of tiles), the Play/Shuffle buttons of a header, or a single item such
    // as a song. Only cheap DOM queries; no positions are measured here.
    function rows() {
        var list = [], last = null;
        root().querySelectorAll(SELECTOR).forEach(function (el) {
            // A lockup inside a card would be the same item twice.
            if (el.parentElement && el.parentElement.closest(SELECTOR)) { return; }
            // No size or position checks here: on Apple Music's large page
            // every such read makes the Pi recalculate the whole layout.
            // (Apple marks tiles right of the screen aria-hidden; they stay
            // reachable.)
            if (el.closest('[hidden]')) { return; }
            var key = el.closest('[data-testid="shelf-item-list"]') ||
                (el.matches('[data-testid="button-action"]') &&
                    el.closest('[data-testid="container-detail-header"], [data-testid="section-content"]')) || el;
            if (last && last.key === key) { last.items.push(el); } else { last = { key: key, items: [el] }; list.push(last); }
        });
        return list;
    }

    function find(list, el) {
        for (var i = 0; i < list.length; i++) {
            var j = list[i].items.indexOf(el);
            if (j !== -1) { return { row: i, index: j }; }
        }
        return null;
    }

    // First focus: the first row that is on screen (the only position check,
    // once, when navigation starts).
    function firstVisible(list) {
        for (var i = 0; i < list.length; i++) {
            var r = list[i].items[0].getBoundingClientRect();
            if (r.top >= 50 && r.bottom <= window.innerHeight - 100) { return list[i].items[0]; }
        }
        return list.length ? list[0].items[0] : null;
    }

    function next(list, from, dir) {
        var at = find(list, from);
        if (!at) { return null; }
        var items = list[at.row].items;
        if (dir === 'left') { return items[at.index - 1] || null; }
        if (dir === 'right') { return items[at.index + 1] || null; }
        // Up/down: the same column in the next row (like a TV menu), without
        // measuring positions.
        var row = list[at.row + (dir === 'down' ? 1 : -1)];
        return row ? row.items[Math.min(at.index, row.items.length - 1)] : null;
    }

    function setFocus(el) {
        if (current && current !== el) { current.classList.remove(FOCUS); }
        current = el;
        if (!el) { return; }
        el.classList.add(FOCUS);
        // Show the frame first, scroll in the next frame: when new tiles come
        // into view, Apple Music renders them and the Pi is busy for a while.
        requestAnimationFrame(function () {
            if (current !== el) { return; }
            // Horizontally within its shelf, then vertically so the item stays
            // between the header and the mini player.
            el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
            var page = root(), r = el.getBoundingClientRect();
            var top = 64, bottom = window.innerHeight - 110;
            if (r.bottom > bottom) {
                page.scrollTop += Math.min(r.bottom - bottom, r.top - top);
            } else if (r.top < top) {
                page.scrollTop -= top - r.top;
            }
        });
    }

    function clearFocus() { setFocus(null); }

    function activate(el) {
        var target = null;
        for (var i = 0; i < TARGETS.length && !target; i++) {
            if (!el.matches(TARGETS[i][0])) { continue; }
            var choices = TARGETS[i][1];
            for (var j = 0; j < choices.length && !target; j++) { target = el.querySelector(choices[j]); }
            target = target || el;
        }
        clearFocus();
        (target || el).click();
    }

    // Apple only renders the tiles of a row that are (nearly) on screen; the
    // rest are empty placeholders until the row scrolls. The placeholder
    // after el, if any.
    function placeholderAfter(el) {
        var li = el.closest('[data-testid="shelf-item-list"] > *');
        var nextLi = li && li.nextElementSibling;
        return nextLi && !nextLi.querySelector(SELECTOR) ? nextLi : null;
    }

    // One remote gesture (one or more steps): find the end item first, then
    // move the frame and scroll once.
    function run(actions, attempt) {
        if (document.querySelector('.sliding-modal.is-open')) { return; }   // the player has its own controls
        var list = rows();
        if (!list.length) { return; }
        var at = current && current.isConnected && find(list, current) ? current : null;
        var rest = null;
        for (var i = 0; i < actions.length; i++) {
            var a = actions[i];
            if (a === 'select') {
                if (at) { activate(at); }
                return;
            }
            if (!at) {
                // Like moOde: the first swipe already moves from the start item.
                at = firstVisible(list);
                if (!at) { return; }
            }
            var n = next(list, at, a);
            if (!n && a === 'right' && placeholderAfter(at)) {
                rest = actions.slice(i);   // continue once Apple has rendered more tiles
                break;
            }
            at = n || at;
        }
        if (at !== current) { setFocus(at); }
        if (rest && (attempt || 0) < 4) {
            var placeholder = placeholderAfter(at);
            requestAnimationFrame(function () {
                placeholder.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
                setTimeout(function () { run(rest, (attempt || 0) + 1); }, 300);
            });
        }
    }

    window.addEventListener('message', function (ev) {
        var d = ev.data;
        if (ev.source !== window || !d || d.source !== 'moode-am-ext' || d.type !== 'command') { return; }
        if (typeof d.action !== 'string' || d.action.indexOf('nav:') !== 0) { return; }
        // Moves that arrive while the page is busy are handled together:
        // one end item, one scroll, instead of a growing backlog.
        queued = queued.concat(d.action.slice(4).split(',').filter(function (a) {
            return ['left', 'right', 'up', 'down', 'select'].indexOf(a) !== -1;
        }));
        if (!scheduled) {
            scheduled = true;
            setTimeout(function () {
                scheduled = false;
                var actions = queued;
                queued = [];
                run(actions);
            }, 0);
        }
    });

    // Touching the screen ends remote navigation, as in moOde.
    window.addEventListener('pointerdown', function (ev) { if (ev.isTrusted) { clearFocus(); } }, true);
}());
