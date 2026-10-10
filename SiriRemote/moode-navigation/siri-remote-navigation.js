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
    const CONTINUATION_BATCH_DELAY_MS = 12;
    const SOURCE_CONTINUATION_DELAY_MS = 55;
    const SCROLL_SETTLE_DELAY_MS = 0;
    const STARTUP_RETURN_POLL_MS = 500;
    const STARTUP_RETURN_WINDOW_MS = 120000;
    const OVERLAY_RETRY_MS = 150;
    const OVERLAY_URL = 'http://127.0.0.1:8765/overlay';
    const LOCAL_DISPLAY_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
    const IS_LOCAL_DISPLAY = LOCAL_DISPLAY_HOSTS.has(window.location.hostname);
    let selected = null;
    let playbackReturnTimer = null;
    let continuationTimer = null;
    let continuationQueue = [];
    let selectionScrollTimer = null;

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
        :root.siri-remote-navigating #viewswitch .btn:not(.${SELECTED_CLASS}),
        :root.siri-remote-navigating #viewswitch .btn:not(.${SELECTED_CLASS}):hover,
        :root.siri-remote-navigating #viewswitch .btn:not(.${SELECTED_CLASS}):focus,
        :root.siri-remote-navigating #viewswitch .btn:not(.${SELECTED_CLASS}):active {
            background: transparent !important;
            background-image: none !important;
            border-color: transparent !important;
            box-shadow: none !important;
            color: inherit !important;
            outline: none !important;
        }
        :root.siri-remote-navigating #viewswitch .btn:not(.${SELECTED_CLASS}) .pane {
            display: none !important;
        }

        #siri-browser-overlay {
            position: fixed;
            z-index: 2147483647;
            pointer-events: none;
            opacity: 0;
            visibility: hidden;
            transition: none;
        }
        #siri-browser-overlay.siri-overlay-visible {
            opacity: 1;
            visibility: visible;
        }
        #siri-browser-overlay .siri-overlay-glass {
            position: absolute;
            inset: 0;
            overflow: hidden;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: rgba(255,255,255,.97);
            text-align: center;
            font-family: Lato, sans-serif;
            background:
                radial-gradient(ellipse at 25% 9%, rgba(255,255,255,.22), transparent 34%),
                radial-gradient(ellipse at 72% 94%, rgba(0,0,0,.13), transparent 56%),
                linear-gradient(145deg, rgba(255,255,255,.025), rgba(255,255,255,.008));
            border: 1px solid rgba(255,255,255,.32);
            box-shadow: inset 5px 8px 10px rgba(255,255,255,.46),
                        inset -8px -14px 22px rgba(0,0,0,.24),
                        0 24px 54px rgba(0,0,0,.42),
                        0 6px 15px rgba(0,0,0,.18);
            -webkit-backdrop-filter: blur(1px) saturate(155%) contrast(104%);
            backdrop-filter: blur(1px) saturate(155%) contrast(104%);
        }
        #siri-browser-overlay .siri-overlay-lens {
            position: absolute;
            inset: 0;
            z-index: 0;
            border-radius: 50%;
            background-repeat: no-repeat;
            transform: scale(1.060);
            transform-origin: center;
            filter: saturate(1.13) contrast(1.055) brightness(1.025);
            opacity: .94;
        }
        #siri-browser-overlay .siri-overlay-lens::before {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: 50%;
            background:
                radial-gradient(ellipse at 31% 11%, rgba(255,255,255,.21), transparent 41%),
                radial-gradient(ellipse at 70% 93%, rgba(0,0,0,.11), transparent 58%);
        }
        #siri-browser-overlay .siri-overlay-lens::after {
            content: '';
            position: absolute;
            left: 15%;
            right: 15%;
            bottom: 2.5%;
            height: 14%;
            border-radius: 50%;
            background: radial-gradient(ellipse, rgba(255,255,255,.17), transparent 70%);
            filter: blur(8px);
        }
        #siri-browser-overlay .siri-overlay-glass::before {
            content: none;
        }
        #siri-browser-overlay .siri-overlay-glass::after {
            content: '';
            position: absolute;
            z-index: 2;
            left: 16%;
            top: 7%;
            width: 46%;
            height: 14%;
            border-radius: 50%;
            background: linear-gradient(180deg, rgba(255,255,255,.52), rgba(255,255,255,.06) 58%, transparent);
            filter: blur(3px);
            transform: rotate(-12deg);
        }
        #siri-browser-overlay .siri-overlay-content {
            position: relative;
            z-index: 3;
            width: 78%;
            height: 78%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: .04em;
            text-shadow:
                -1px -1px 2px rgba(0,0,0,.92),
                 1px -1px 2px rgba(0,0,0,.92),
                -1px  1px 2px rgba(0,0,0,.92),
                 1px  1px 2px rgba(0,0,0,.92),
                 0 2px 7px rgba(0,0,0,.78);
            filter: drop-shadow(0 2px 9px rgba(0,0,0,.50));
        }
        #siri-browser-overlay .siri-overlay-label {
            font-size: clamp(1.8rem, 7.6vw, 4rem);
            line-height: 1.04;
            font-weight: 700;
        }
        #siri-browser-overlay .siri-overlay-value {
            font-size: clamp(3.6rem, 16vw, 7.8rem);
            line-height: .98;
            font-weight: 800;
        }
        #siri-browser-overlay .siri-overlay-renderer {
            max-width: 100%;
            font-size: clamp(2rem, 8.5vw, 4.2rem);
            line-height: 1.02;
            font-weight: 800;
        }
        #siri-browser-overlay .siri-glyph {
            position: relative;
            width: 58%;
            height: 58%;
        }
        #siri-browser-overlay .siri-play::before,
        #siri-browser-overlay .siri-next .triangle,
        #siri-browser-overlay .siri-previous .triangle {
            content: '';
            position: absolute;
            top: 16%;
            height: 68%;
            background: currentColor;
        }
        #siri-browser-overlay .siri-play::before {
            left: 25%;
            width: 56%;
            clip-path: polygon(0 0, 100% 50%, 0 100%);
        }
        #siri-browser-overlay .siri-pause::before,
        #siri-browser-overlay .siri-pause::after {
            content: '';
            position: absolute;
            top: 15%;
            width: 21%;
            height: 70%;
            border-radius: .35rem;
            background: currentColor;
        }
        #siri-browser-overlay .siri-pause::before { left: 22%; }
        #siri-browser-overlay .siri-pause::after { right: 22%; }
        #siri-browser-overlay .siri-next .triangle {
            width: 36%;
            clip-path: polygon(0 0, 100% 50%, 0 100%);
        }
        #siri-browser-overlay .siri-next .triangle.one { left: 8%; }
        #siri-browser-overlay .siri-next .triangle.two { left: 38%; }
        #siri-browser-overlay .siri-next .bar,
        #siri-browser-overlay .siri-previous .bar {
            position: absolute;
            top: 16%;
            width: 9%;
            height: 68%;
            border-radius: .2rem;
            background: currentColor;
        }
        #siri-browser-overlay .siri-next .bar { right: 8%; }
        #siri-browser-overlay .siri-previous .triangle {
            width: 36%;
            clip-path: polygon(100% 0, 0 50%, 100% 100%);
        }
        #siri-browser-overlay .siri-previous .triangle.one { right: 8%; }
        #siri-browser-overlay .siri-previous .triangle.two { right: 38%; }
        #siri-browser-overlay .siri-previous .bar { left: 8%; }
        #siri-browser-overlay .siri-battery {
            position: relative;
            width: 68%;
            height: 31%;
            border: clamp(5px, 1.4vw, 10px) solid currentColor;
            border-radius: 1.3rem;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: clamp(2.5rem, 11vw, 5.4rem);
            font-weight: 800;
        }
        #siri-browser-overlay .siri-battery::after {
            content: '';
            position: absolute;
            right: -8%;
            width: 5.5%;
            height: 42%;
            border-radius: 0 .45rem .45rem 0;
            background: currentColor;
        }
        #siri-browser-overlay .siri-power {
            position: relative;
            width: 76%;
            height: 76%;
            display: grid;
            place-items: center;
        }
        #siri-browser-overlay .siri-power svg {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
        }
        #siri-browser-overlay .siri-power span {
            position: relative;
            top: 5%;
            font-size: clamp(4.2rem, 18vw, 8.4rem);
            line-height: 1;
            font-weight: 800;
        }
    `;
    document.head.appendChild(style);

    let overlayVersion = -1;
    let overlayElement = null;

    function makeElement(className, text) {
        const element = document.createElement('div');
        element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    function ensureOverlay() {
        if (overlayElement && overlayElement.isConnected) return overlayElement;
        overlayElement = makeElement('');
        overlayElement.id = 'siri-browser-overlay';
        overlayElement.setAttribute('aria-hidden', 'true');
        const glass = makeElement('siri-overlay-glass');
        glass.appendChild(makeElement('siri-overlay-lens'));
        glass.appendChild(makeElement('siri-overlay-content'));
        overlayElement.appendChild(glass);
        document.body.appendChild(overlayElement);
        return overlayElement;
    }

    function overlayContent() {
        return ensureOverlay().querySelector('.siri-overlay-content');
    }

    function positionOverlay() {
        const overlay = ensureOverlay();
        const selectors = [
            '#coverart-url img', '#coverart-url', '#playback-cover img',
            '#playback-cover', '#coverart', '.coverart img',
        ];
        let cover = null;
        for (const selector of selectors) {
            cover = Array.from(document.querySelectorAll(selector)).find((candidate) => {
                const rect = candidate.getBoundingClientRect();
                return rect.width > 80 && rect.height > 80 && visible(candidate);
            });
            if (cover) break;
        }
        let size;
        let centerX;
        let centerY;
        if (cover) {
            const rect = cover.getBoundingClientRect();
            size = Math.min(rect.width, rect.height) * .88;
            centerX = rect.left + rect.width / 2;
            centerY = rect.top + rect.height / 2;
        } else {
            size = Math.min(window.innerWidth, window.innerHeight) * .68;
            centerX = window.innerWidth / 2;
            centerY = window.innerHeight * .29375;
        }
        size = Math.max(180, Math.min(size, window.innerWidth * .94));
        const overlayLeft = centerX - size / 2;
        const overlayTop = centerY - size / 2;
        overlay.style.width = `${size}px`;
        overlay.style.height = `${size}px`;
        overlay.style.left = `${overlayLeft}px`;
        overlay.style.top = `${overlayTop}px`;

        const lens = overlay.querySelector('.siri-overlay-lens');
        const coverImage = cover && (
            cover.matches('img') ? cover : cover.querySelector('img')
        );
        const imageUrl = coverImage && (coverImage.currentSrc || coverImage.src);
        if (lens && coverImage && imageUrl) {
            const imageRect = coverImage.getBoundingClientRect();
            lens.style.backgroundImage = `url(${JSON.stringify(imageUrl)})`;
            lens.style.backgroundSize = `${imageRect.width}px ${imageRect.height}px`;
            lens.style.backgroundPosition =
                `${imageRect.left - overlayLeft}px ${imageRect.top - overlayTop}px`;
        } else if (lens) {
            lens.style.backgroundImage = 'none';
        }
    }

    function symbol(kind) {
        const glyph = makeElement(`siri-glyph siri-${kind}`);
        if (kind === 'next' || kind === 'previous') {
            glyph.appendChild(makeElement('triangle one'));
            glyph.appendChild(makeElement('triangle two'));
            glyph.appendChild(makeElement('bar'));
        }
        return glyph;
    }

    function powerSymbol(number) {
        const power = makeElement('siri-power');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('aria-hidden', 'true');
        svg.innerHTML = '<path d="M31 21a38 38 0 1 0 38 0" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/><path d="M50 8v39" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>';
        power.appendChild(svg);
        const digit = document.createElement('span');
        digit.textContent = number;
        power.appendChild(digit);
        return power;
    }

    function rendererName(rawName) {
        const names = {
            'AIRPLAY': 'AirPlay',
            'BLUETOOTH': 'Bluetooth',
            'SPOTIFY': 'Spotify',
            'DEEZER': 'Deezer',
            'SQUEEZELITE': 'Squeezelite',
            'PLEXAMP': 'Plexamp',
            'ROONBRIDGE': 'RoonBridge',
            'AUDIO INPUT': 'Audio Input',
            'MULTIROOM RECEIVER': 'Multiroom\nReceiver',
            'RENDERER': 'Renderer',
        };
        return names[rawName] || rawName;
    }

    function renderOverlay(text) {
        const overlay = ensureOverlay();
        const content = overlayContent();
        content.replaceChildren();
        const normalized = String(text || '').trim().toUpperCase();
        if (normalized === 'PLAY') {
            content.appendChild(symbol('play'));
        } else if (normalized === 'PAUSE') {
            content.appendChild(symbol('pause'));
        } else if (normalized === 'NEXT') {
            content.appendChild(symbol('next'));
        } else if (normalized === 'PREVIOUS') {
            content.appendChild(symbol('previous'));
        } else if (normalized.startsWith('VOLUME:')) {
            content.appendChild(makeElement('siri-overlay-label', 'Volume'));
            content.appendChild(makeElement('siri-overlay-value', normalized.slice(7)));
        } else if (normalized.startsWith('BATTERY:')) {
            const battery = makeElement('siri-battery');
            battery.appendChild(makeElement(
                'siri-battery-value', normalized.slice(8),
            ));
            content.appendChild(battery);
        } else if (normalized.startsWith('DISABLED:')) {
            content.appendChild(makeElement('siri-overlay-label', 'Disabled'));
            const renderer = makeElement(
                'siri-overlay-renderer', rendererName(normalized.slice(9)),
            );
            renderer.style.whiteSpace = 'pre-line';
            content.appendChild(renderer);
        } else if (normalized.startsWith('SHUTDOWN:')) {
            content.appendChild(powerSymbol(normalized.slice(9)));
        } else if (normalized === 'SHUTTING DOWN') {
            content.appendChild(powerSymbol('0'));
        } else {
            content.appendChild(makeElement('siri-overlay-renderer', normalized));
        }
        positionOverlay();
    }

    function applyOverlayState(state) {
        const overlay = ensureOverlay();
        if (!state.visible) {
            overlay.classList.remove('siri-overlay-visible');
            return;
        }
        renderOverlay(state.text);
        overlay.classList.add('siri-overlay-visible');
    }

    function pollOverlay() {
        if (!IS_LOCAL_DISPLAY) return;
        // This is a long-poll: the daemon holds the request until its state
        // changes. A button event therefore wakes Chromium immediately instead
        // of waiting for the next fixed polling interval.
        fetch(`${OVERLAY_URL}?since=${overlayVersion}`, {cache: 'no-store'})
            .then((response) => {
                if (!response.ok) throw new Error(`overlay HTTP ${response.status}`);
                return response.json();
            })
            .then((state) => {
                if (Number.isInteger(state.version) && state.version !== overlayVersion) {
                    overlayVersion = state.version;
                    applyOverlayState(state);
                }
            })
            .then(() => pollOverlay())
            .catch(() => window.setTimeout(pollOverlay, OVERLAY_RETRY_MS));
    }

    window.addEventListener('resize', function () {
        if (overlayElement && overlayElement.classList.contains('siri-overlay-visible')) {
            positionOverlay();
        }
    });

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

    function cancelSelectionScroll() {
        if (selectionScrollTimer !== null) {
            window.clearTimeout(selectionScrollTimer);
            selectionScrollTimer = null;
        }
    }

    function scrollToSelection() {
        selectionScrollTimer = null;
        if (selected && selected.isConnected) {
            selected.scrollIntoView({
                block: 'center',
                inline: 'nearest',
                behavior: 'auto',
            });
        }
    }

    function mark(element, scrollAfterMark) {
        // moOde can replace a view node while the menu is opening. Remove any
        // selection class left on such an older node as well as the tracked one.
        document.querySelectorAll(`.${SELECTED_CLASS}`).forEach((item) => {
            if (item !== element) item.classList.remove(SELECTED_CLASS);
        });
        if (selected && selected !== element) {
            selected.classList.remove(SELECTED_CLASS);
        }
        selected = element;
        selected.classList.add(SELECTED_CLASS);
        document.documentElement.classList.add('siri-remote-navigating');
        cancelSelectionScroll();
        // Continuation keystrokes for a multi-step swipe arrive shortly after
        // the first step. Defer scrolling just long enough to combine them,
        // then animate only once to the final selection. This avoids stacking
        // several native smooth-scroll animations on top of each other.
        if (scrollAfterMark !== false) {
            selectionScrollTimer = window.setTimeout(
                scrollToSelection, SCROLL_SETTLE_DELAY_MS,
            );
        }
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
        cancelSelectionScroll();
    }

    function runContinuations() {
        continuationTimer = null;
        if (selected && selected.matches(SOURCE_SELECTOR) && continuationQueue.length) {
            move(continuationQueue.shift(), true, false);
            scrollToSelection();
            if (continuationQueue.length) {
                continuationTimer = window.setTimeout(
                    runContinuations, SOURCE_CONTINUATION_DELAY_MS,
                );
            }
            return;
        }
        while (continuationQueue.length) {
            move(continuationQueue.shift(), true, false);
        }
        // All focus changes have completed synchronously. Center the final
        // item immediately so the outline never remains outside the viewport.
        scrollToSelection();
    }

    function queueContinuation(direction) {
        // The first step may already have scheduled a scroll. A continuation
        // makes that an intermediate selection, so only the final step scrolls.
        cancelSelectionScroll();
        continuationQueue.push(direction);
        if (continuationTimer !== null) {
            window.clearTimeout(continuationTimer);
        }
        continuationTimer = window.setTimeout(
            runContinuations, CONTINUATION_BATCH_DELAY_MS,
        );
        return true;
    }

    function move(direction, continuation, scrollAfterMove) {
        const items = candidates();
        const current = startingItem(items);
        if (!current) {
            return false;
        }
        if (current.matches(SOURCE_SELECTOR)) {
            // Keep a short swipe precise, but also consume the continuation
            // events from a longer/faster gesture. This lets one flick travel
            // across the complete compact Library source chooser.
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
        mark(options[0].item, scrollAfterMove !== false);
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
    pollOverlay();
}());
