/* Native-selectable Liquid Glass extension for moOde Audio. */
(function () {
    'use strict';

    const THEME_NAME = 'Liquid Glass';
    const ROOT_CLASS = 'liquid-glass-theme';
    const LIBRARY_CLASS = 'liquid-glass-library-visible';
    let librarySwitch = null;
    let libraryObserver = null;
    let serverTheme = null;
    let lensImageUrl = '';

    const LENS_CONTROLS = [
        '#playbtns .btn',
        '#togglebtns .btn',
        '#panel-footer #playbar-controls .btn',
        '#panel-footer #playbar-toggles .btn',
    ].join(',');

    const COVER_IMAGES = [
        '#cover-backdrop img.ss-backdrop',
        '#coverart-url img',
        '#ss-coverart-url img',
        '#playback-cover img',
        '#coverart img',
        '.coverart img',
    ];

    function configuredTheme() {
        if (serverTheme !== null) return serverTheme;
        if (typeof SESSION === 'undefined' || !SESSION || !SESSION.json) return '';
        return String(SESSION.json.themename || '');
    }

    function visible(element) {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 80 && rect.height > 80 &&
            style.display !== 'none' && style.visibility !== 'hidden';
    }

    function activeCoverImage() {
        for (const selector of COVER_IMAGES) {
            const image = Array.from(document.querySelectorAll(selector)).find(visible);
            if (image) return image;
        }
        return null;
    }

    function clearControlLenses() {
        document.querySelectorAll(LENS_CONTROLS).forEach(function (control) {
            control.style.removeProperty('--liquid-glass-cover-image');
            control.style.removeProperty('--liquid-glass-cover-size');
            control.style.removeProperty('--liquid-glass-cover-position');
        });
        lensImageUrl = '';
    }

    function syncControlLenses() {
        if (!document.documentElement.classList.contains(ROOT_CLASS)) {
            clearControlLenses();
            return;
        }
        const image = activeCoverImage();
        const imageUrl = image && (image.currentSrc || image.src);
        if (!image || !imageUrl) {
            clearControlLenses();
            return;
        }

        const imageRect = image.getBoundingClientRect();
        if (!imageRect.width || !imageRect.height) return;

        // Use the transformed ss-backdrop rectangle itself. moOde scales its
        // backdrop container and repositions the child image; reconstructing
        // that with viewport dimensions causes a visibly different crop.
        // Mapping this real rectangle into every control gives a pixel-exact,
        // sharp continuation of the blurred backdrop behind it.
        const renderedWidth = imageRect.width;
        const renderedHeight = imageRect.height;
        const imageLeft = imageRect.left;
        const imageTop = imageRect.top;
        const cssImage = `url(${JSON.stringify(imageUrl)})`;
        const cssSize = `${renderedWidth}px ${renderedHeight}px`;

        document.querySelectorAll(LENS_CONTROLS).forEach(function (control) {
            const rect = control.getBoundingClientRect();
            control.style.setProperty('--liquid-glass-cover-image', cssImage);
            control.style.setProperty('--liquid-glass-cover-size', cssSize);
            control.style.setProperty(
                '--liquid-glass-cover-position',
                `${imageLeft - rect.left}px ${imageTop - rect.top}px`,
            );
        });
        lensImageUrl = imageUrl;
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
            window.requestAnimationFrame(syncControlLenses);
        } else {
            document.documentElement.classList.remove(LIBRARY_CLASS);
            if (wasActive || lensImageUrl) clearControlLenses();
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
        if (!document.hidden) {
            readServerTheme();
            window.requestAnimationFrame(syncControlLenses);
        }
    });
    window.addEventListener('resize', function () {
        window.requestAnimationFrame(syncControlLenses);
    });
}());
