/* Native-selectable Liquid Glass extension for moOde Audio. */
(function () {
    'use strict';

    const THEME_NAME = 'Liquid Glass';
    const ROOT_CLASS = 'liquid-glass-theme';
    const LIBRARY_CLASS = 'liquid-glass-library-visible';
    let librarySwitch = null;
    let libraryObserver = null;
    let serverTheme = null;

    function configuredTheme() {
        if (serverTheme !== null) return serverTheme;
        if (typeof SESSION === 'undefined' || !SESSION || !SESSION.json) return '';
        return String(SESSION.json.themename || '');
    }

    async function readServerTheme() {
        try {
            const response = await window.fetch(
                'command/cfg-table.php?cmd=get_cfg_system_value&param=themename',
                {cache: 'no-store'},
            );
            if (!response.ok) return;
            serverTheme = String(await response.json());
            syncTheme();
        } catch (_error) {
            // SESSION remains a complete fallback when the request is unavailable.
        }
    }

    function syncLibraryVisibility() {
        const visible = Boolean(
            librarySwitch && window.getComputedStyle(librarySwitch).display !== 'none'
        );
        document.documentElement.classList.toggle(LIBRARY_CLASS, visible);
    }

    function observeLibrary() {
        if (libraryObserver || !document.body) return;
        librarySwitch = document.getElementById('viewswitch');
        if (!librarySwitch) return;
        libraryObserver = new MutationObserver(syncLibraryVisibility);
        libraryObserver.observe(librarySwitch, {
            attributes: true,
            attributeFilter: ['class', 'style'],
        });
        syncLibraryVisibility();
    }

    function syncTheme() {
        const active = configuredTheme() === THEME_NAME;
        const wasActive = document.documentElement.classList.contains(ROOT_CLASS);
        document.documentElement.classList.toggle(ROOT_CLASS, active);
        if (active) {
            observeLibrary();
            if (!wasActive) syncLibraryVisibility();
        } else {
            document.documentElement.classList.remove(LIBRARY_CLASS);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            syncTheme();
            readServerTheme();
        }, {once: true});
    } else {
        syncTheme();
        readServerTheme();
    }

    // Preferences updates SESSION before moOde reloads the page. This slow
    // check does not read layout; Library visibility itself is event-driven by
    // the MutationObserver above, so scrolling never triggers periodic reflow.
    window.setInterval(syncTheme, 2000);
    window.setInterval(readServerTheme, 10000);
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) readServerTheme();
    });
}());
