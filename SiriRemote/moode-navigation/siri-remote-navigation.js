/* Siri Remote spatial library navigation for moOde Audio. */
(function () {
    'use strict';

    const SELECTED_CLASS = 'siri-remote-selected';
    const SOURCE_SELECTOR = [
        '#viewswitch .radio-view-btn',
        '#viewswitch .folder-view-btn',
        '#viewswitch .tag-view-btn',
        '#viewswitch .album-view-btn',
        '#viewswitch .playlist-view-btn',
    ].join(', ');
    const PLAYBACK_RETURN_MS = 5000;
    const CONTINUATION_DELAY_MS = 85;
    const STARTUP_RETURN_POLL_MS = 500;
    const STARTUP_RETURN_WINDOW_MS = 120000;
    const LOCAL_DISPLAY_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
    const IS_LOCAL_DISPLAY = LOCAL_DISPLAY_HOSTS.has(window.location.hostname);
    let selected = null;
    let playbackReturnTimer = null;
    let continuationTimer = null;
    let continuationQueue = [];

    const style = document.createElement('style');
    style.textContent = `
        .${SELECTED_CLASS} {
            outline: 4px solid var(--accentxts) !important;
            outline-offset: -4px;
            border-radius: .35rem;
            background-color: var(--accentxta) !important;
            scroll-margin-block: 3.25rem 8rem;
        }
        :root.siri-remote-navigating #lib-content li.active:not(.${SELECTED_CLASS}),
        :root.siri-remote-navigating .albumslist .active:not(.${SELECTED_CLASS}),
        :root.siri-remote-navigating #radio-covers li.active:not(.${SELECTED_CLASS}),
        :root.siri-remote-navigating #playlist-covers li.active:not(.${SELECTED_CLASS}) {
            background-color: transparent !important;
            color: inherit !important;
        }
        :root.siri-remote-navigating #viewswitch .btn.active:not(.${SELECTED_CLASS}),
        :root.siri-remote-navigating #viewswitch .btn.btn-primary:not(.${SELECTED_CLASS}) {
            background: transparent !important;
            box-shadow: none !important;
            color: inherit !important;
        }
    `;
    document.head.appendChild(style);

    function visible(element) {
        const rect = element.getBoundingClientRect();
        const css = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 &&
            css.display !== 'none' && css.visibility !== 'hidden';
    }

    function candidates() {
        const sources = Array.from(document.querySelectorAll(SOURCE_SELECTOR)).filter(visible);
        if (sources.length) {
            return sources;
        }
        let selector = '';
        switch (window.currentView) {
        case 'album':
            selector = '#albumcovers > li:has(img)';
            break;
        case 'tag':
            selector = '#albumsList > li.lib-entry';
            break;
        case 'folder':
            selector = '#folderlist > li';
            break;
        case 'playlist':
            selector = '#playlist-covers > li:has(img)';
            break;
        case 'radio':
            selector = '#radio-covers > li:has(img)';
            break;
        default:
            return [];
        }
        return Array.from(document.querySelectorAll(selector)).filter(visible);
    }

    function center(element) {
        const rect = element.getBoundingClientRect();
        return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
    }

    function mark(element) {
        if (selected && selected !== element) {
            selected.classList.remove(SELECTED_CLASS);
        }
        selected = element;
        selected.classList.add(SELECTED_CLASS);
        document.documentElement.classList.add('siri-remote-navigating');
        // Re-centering every item with smooth scrolling queues overlapping
        // animations during a multi-step swipe. "nearest" leaves visible
        // items still and scrolls only the minimum amount at an edge.
        selected.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'auto'});
    }

    function clearSelection() {
        cancelContinuations();
        if (selected) {
            selected.classList.remove(SELECTED_CLASS);
            selected = null;
        }
        document.documentElement.classList.remove('siri-remote-navigating');
    }

    function isPlayback() {
        return String(window.currentView).startsWith('playback');
    }

    function isActuallyPlaying() {
        return Boolean(window.MPD && window.MPD.json && window.MPD.json.state === 'play');
    }

    function returnToPlayback() {
        playbackReturnTimer = null;
        if (isPlayback() || !isActuallyPlaying()) {
            return;
        }
        clearSelection();
        const openDropdown = document.querySelector('#viewswitch .dropdown.open #current-tab');
        if (openDropdown) {
            openDropdown.click();
        }
        const playbar = document.querySelector('#playbar-switch, #playbar-cover, #playbar-title');
        if (playbar) {
            playbar.click();
        }
    }

    function schedulePlaybackReturn() {
        if (playbackReturnTimer !== null) {
            window.clearTimeout(playbackReturnTimer);
            playbackReturnTimer = null;
        }
        // The kiosk browser runs at http://localhost/. Network clients load
        // the same marked script, but must retain their independently chosen
        // view instead of inheriting the kiosk's five-second idle behavior.
        if (!IS_LOCAL_DISPLAY) {
            return;
        }
        if (!isPlayback()) {
            playbackReturnTimer = window.setTimeout(returnToPlayback, PLAYBACK_RETURN_MS);
        }
    }

    function scheduleAfterViewChange() {
        window.setTimeout(schedulePlaybackReturn, 80);
    }

    function watchStartupAutoplay() {
        if (!IS_LOCAL_DISPLAY) {
            return;
        }
        const deadline = Date.now() + STARTUP_RETURN_WINDOW_MS;
        const interval = window.setInterval(function () {
            if (Date.now() >= deadline) {
                window.clearInterval(interval);
                return;
            }
            // moOde may first render its saved Library view and only later
            // start playback. Wait for both states instead of arming a timer
            // prematurely while MPD is still stopped during boot.
            if (isActuallyPlaying() && !isPlayback()) {
                if (playbackReturnTimer === null) {
                    schedulePlaybackReturn();
                }
                window.clearInterval(interval);
            }
        }, STARTUP_RETURN_POLL_MS);
    }

    function openSourcePicker() {
        function openMenu() {
            const toggle = document.getElementById('current-tab');
            if (!toggle) {
                return;
            }
            if (!Array.from(document.querySelectorAll(SOURCE_SELECTOR)).some(visible)) {
                toggle.click();
            }
            window.setTimeout(function () {
                const items = Array.from(document.querySelectorAll(SOURCE_SELECTOR)).filter(visible);
                const current = startingItem(items);
                if (current) {
                    mark(current);
                }
                schedulePlaybackReturn();
            }, 80);
        }

        clearSelection();
        if (isPlayback()) {
            const library = document.querySelector('#coverart-url, #playback-switch');
            if (library) {
                library.click();
            }
            window.setTimeout(openMenu, 80);
        } else {
            openMenu();
        }
    }

    function startingItem(items) {
        if (selected && items.includes(selected)) {
            return selected;
        }
        selected = null;
        const active = items.find((item) => item.classList.contains('active'));
        return active || items[0] || null;
    }

    function cancelContinuations() {
        if (continuationTimer !== null) {
            window.clearTimeout(continuationTimer);
            continuationTimer = null;
        }
        continuationQueue = [];
    }

    function runContinuation() {
        continuationTimer = null;
        const direction = continuationQueue.shift();
        if (direction) {
            move(direction, true);
        }
        if (continuationQueue.length) {
            continuationTimer = window.setTimeout(
                runContinuation, CONTINUATION_DELAY_MS,
            );
        }
    }

    function queueContinuation(direction) {
        continuationQueue.push(direction);
        if (continuationTimer === null) {
            continuationTimer = window.setTimeout(
                runContinuation, CONTINUATION_DELAY_MS,
            );
        }
        return true;
    }

    function move(direction, continuation) {
        const items = candidates();
        const current = startingItem(items);
        if (!current) {
            return false;
        }
        if (current.matches(SOURCE_SELECTOR)) {
            // A long/flick gesture remains one precise step in the compact
            // Library source chooser; continuation events are only for grids.
            if (continuation) {
                schedulePlaybackReturn();
                return true;
            }
            if (direction === 'left') direction = 'up';
            if (direction === 'right') direction = 'down';
        }
        const origin = center(current);
        const options = items.filter((item) => item !== current).map((item) => {
            const point = center(item);
            return {item, dx: point.x - origin.x, dy: point.y - origin.y};
        }).filter((option) => {
            if (direction === 'left') return option.dx < -2;
            if (direction === 'right') return option.dx > 2;
            if (direction === 'up') return option.dy < -2;
            return option.dy > 2;
        });
        if (!options.length) {
            schedulePlaybackReturn();
            return true;
        }
        options.sort((a, b) => {
            const score = (option) => {
                const primary = direction === 'left' || direction === 'right' ?
                    Math.abs(option.dx) : Math.abs(option.dy);
                const secondary = direction === 'left' || direction === 'right' ?
                    Math.abs(option.dy) : Math.abs(option.dx);
                return primary + secondary * 2.5;
            };
            return score(a) - score(b);
        });
        mark(options[0].item);
        schedulePlaybackReturn();
        return true;
    }

    function activateSelected(fallbackSide) {
        const items = candidates();
        let item = startingItem(items);
        if (!item) {
            // Preserve the original left/right click behavior on Playback.
            if (String(window.currentView).startsWith('playback')) {
                const button = document.querySelector(fallbackSide === 'left' ? '.prev' : '.next');
                if (button && fallbackSide) button.click();
                return Boolean(button && fallbackSide);
            }
            return false;
        }
        if (!selected) {
            mark(item);
        }
        if (item.matches(SOURCE_SELECTOR)) {
            item.click();
        } else if (window.currentView === 'album' || window.currentView === 'playlist' ||
                window.currentView === 'radio') {
            const image = item.querySelector('img');
            if (image) image.click();
        } else if (window.currentView === 'tag') {
            item.click();
        } else if (window.currentView === 'folder') {
            const browse = item.querySelector('.db-browse');
            const action = item.querySelector('.db-entry, .db-action');
            (browse || action || item).click();
        }
        clearSelection();
        scheduleAfterViewChange();
        return true;
    }

    document.addEventListener('keydown', function (event) {
        if (!event.ctrlKey || !event.altKey || !event.shiftKey) return;
        let handled = false;
        const key = event.key.toLowerCase();
        if (key === 'h' || key === 'l' || key === 'k' || key === 'j') {
            cancelContinuations();
            const directions = {h: 'left', l: 'right', k: 'up', j: 'down'};
            handled = move(directions[key], false);
        }
        else if (key === 'q') handled = queueContinuation('left');
        else if (key === 'r') handled = queueContinuation('right');
        else if (key === 'w') handled = queueContinuation('up');
        else if (key === 's') handled = queueContinuation('down');
        else if (event.key === 'Enter') {
            cancelContinuations();
            handled = activateSelected(null);
        }
        else if (key === 'p' || key === 'n') {
            cancelContinuations();
            handled = activateSelected(key === 'p' ? 'left' : 'right');
        }
        else if (key === 'a') {
            cancelContinuations();
            scheduleAfterViewChange();
            handled = true;
        }
        else if (key === 'b') {
            cancelContinuations();
            openSourcePicker();
            handled = true;
        }
        else return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);

    document.addEventListener('pointerdown', function () {
        cancelContinuations();
        if (!isPlayback()) {
            schedulePlaybackReturn();
        }
    }, true);

    document.addEventListener('click', function (event) {
        if (event.target.closest(SOURCE_SELECTOR)) {
            clearSelection();
            scheduleAfterViewChange();
        }
    }, true);

    new MutationObserver(function () {
        if (selected && !document.documentElement.contains(selected)) {
            clearSelection();
        }
    }).observe(document.getElementById('content'), {childList: true, subtree: true});

    watchStartupAutoplay();
}());
