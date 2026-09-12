/* Siri Remote spatial library navigation for moOde Audio. */
(function () {
    'use strict';

    const SELECTED_CLASS = 'siri-remote-selected';
    let selected = null;

    const style = document.createElement('style');
    style.textContent = `
        .${SELECTED_CLASS} {
            outline: 4px solid var(--accentxts) !important;
            outline-offset: -4px;
            border-radius: .35rem;
            background-color: var(--accentxta) !important;
        }
        :root.siri-remote-navigating #lib-content li.active:not(.${SELECTED_CLASS}),
        :root.siri-remote-navigating .albumslist .active:not(.${SELECTED_CLASS}),
        :root.siri-remote-navigating #radio-covers li.active:not(.${SELECTED_CLASS}),
        :root.siri-remote-navigating #playlist-covers li.active:not(.${SELECTED_CLASS}) {
            background-color: transparent !important;
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
        selected.scrollIntoView({block: 'center', inline: 'center', behavior: 'smooth'});
    }

    function clearSelection() {
        if (selected) {
            selected.classList.remove(SELECTED_CLASS);
            selected = null;
        }
        document.documentElement.classList.remove('siri-remote-navigating');
    }

    function startingItem(items) {
        if (selected && items.includes(selected)) {
            return selected;
        }
        selected = null;
        const active = items.find((item) => item.classList.contains('active'));
        return active || items[0] || null;
    }

    function move(direction) {
        const items = candidates();
        const current = startingItem(items);
        if (!current) {
            return false;
        }
        if (!selected) {
            mark(current);
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
        if (window.currentView === 'album' || window.currentView === 'playlist' ||
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
        return true;
    }

    document.addEventListener('keydown', function (event) {
        if (!event.ctrlKey || !event.altKey || !event.shiftKey) return;
        let handled = false;
        const key = event.key.toLowerCase();
        if (key === 'h') handled = move('left');
        else if (key === 'l') handled = move('right');
        else if (key === 'k') handled = move('up');
        else if (key === 'j') handled = move('down');
        else if (event.key === 'Enter') handled = activateSelected(null);
        else if (key === 'p') handled = activateSelected('left');
        else if (key === 'n') handled = activateSelected('right');
        else return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);

    new MutationObserver(function () {
        if (selected && !document.documentElement.contains(selected)) {
            clearSelection();
        }
    }).observe(document.getElementById('content'), {childList: true, subtree: true});
}());
