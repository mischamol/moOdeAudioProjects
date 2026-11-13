// Apple Music in moOde's theme: background, text and accent colour from
// Preferences > Appearance, and moOde's blurred cover backdrop behind the
// full-screen player. Light/dark follows the theme too (launcher flag), and
// so do the colours of the Siri Remote overlay.
(function () {
    'use strict';
    if (window.top !== window) { return; }

    var style = document.createElement('style');
    style.id = 'moode-theme';
    var applied = '';

    function css(t) {
        var bg = 'rgb(' + t.bg + ')';
        var bga = function (a) { return 'rgba(' + t.bg + ',' + a + ')'; };
        var mbg = 'rgba(' + t.mbg + ')';
        var rules = [
            ':root:root {',
            '  --keyColor: ' + t.accent + ' !important;',
            '  --musicKeyColor: ' + t.accent + ' !important;',
            '  --keyAccentColor: ' + t.accent + ' !important;',
            '  --keyColor-focus-color: ' + t.accent + '99 !important;',
            '  --sk-focus-color: ' + t.accent + '99 !important;',
            '  --pageBG: ' + bg + ' !important;',
            '  --pageBG-rgb: ' + t.bg + ' !important;',
            '  --pageBG-' + (t.dark ? 'dark' : 'light') + ': ' + bg + ' !important;',
            '  --pageBG-' + (t.dark ? 'dark' : 'light') + '-rgb: ' + t.bg + ' !important;',
            '  --footerBg: ' + bg + ' !important;',
            '  --mobileNavigationBG: ' + bg + ' !important;',
            '  --navSidebarBG: ' + bg + ' !important;',
            '  --miniPlayerBackground: ' + bga(0.96) + ' !important;',
            '  --playerBackground: ' + bga(0.96) + ' !important;',
            '  --playerBackgroundFallback: ' + bga(0.97) + ' !important;',
            '  --fallbackMaterialBG: ' + bga(0.97) + ' !important;',
            '  --glassMaterialBackground: ' + mbg + ' !important;',
            // moOde's accent for the remote focus frame (applenav.js).
            '  --moode-accent: ' + t.accent + ';',
            // Siri Remote overlay (siri-overlay.css), as in moOde's page.
            '  --siri-overlay-fill: ' + bga(0.9) + ';',
            '  --siri-overlay-text: ' + t.tx + ';',
            '  --siri-overlay-shadow: ' + (t.dark ? 'rgba(0,0,0,.92)' : 'rgba(255,255,255,.85)') + ';',
            '}',
            'html, body { background-color: ' + bg + ' !important; }',
            '.navigation { background-color: ' + bg + ' !important; }',
            '#moode-return { background: ' + mbg + ' !important; color: ' + t.tx + ' !important; }',
            '#moode-return:active { color: ' + t.accent + ' !important; }'
        ];
        // moOde's cover backdrop: the cover, blurred and scaled, under a veil
        // of the theme colour (static, so it costs no CPU once drawn).
        var veil = 'linear-gradient(' + bga(Math.min(0.9, t.alpha)) + ',' + bga(Math.min(0.95, t.alpha + 0.1)) + ')';
        rules.push('.sliding-modal-backdrop .backdrop, .dynamic-backdrop { background: ' + bg + ' !important; }');
        if (t.backdrop) {
            // The blur is drawn on pseudo-elements so the content stays sharp.
            rules.push(
                '.sliding-modal-backdrop .backdrop { overflow: hidden; }',
                '.sliding-modal-backdrop .backdrop::before {',
                '  content: ""; position: absolute; inset: 0; z-index: 0;',
                '  background: var(--moode-cover, none) center / cover no-repeat;',
                '  filter: blur(' + t.blur + '); transform: scale(' + t.scale + ');',
                '}',
                '.sliding-modal-backdrop .backdrop::after {',
                '  content: ""; position: absolute; inset: 0; z-index: 0; background: ' + veil + ';',
                '}'
            );
        }
        return rules.join('\n');
    }

    function apply(t) {
        if (!t || !t.bg) { return; }
        var text = css(t);
        if (text === applied) { return; }
        applied = text;
        style.textContent = text;
        if (!style.isConnected) { (document.head || document.documentElement).appendChild(style); }
    }

    function load() {
        chrome.runtime.sendMessage({ type: 'moode-theme' }, apply);
    }
    load();
    // Follow theme changes made in moOde while Apple Music runs.
    setInterval(load, 30000);
    document.addEventListener('DOMContentLoaded', function () { if (applied && !style.isConnected) { document.head.appendChild(style); } });

    // Current cover for the backdrop, from nowplaying.js.
    var cover = '';
    window.addEventListener('message', function (ev) {
        var d = ev.data;
        if (ev.source !== window || !d || d.source !== 'moode-am-page' || d.type !== 'state') { return; }
        var art = d.state && d.state.item && d.state.item.artwork;
        if (!art || art === cover || !/^https:\/\/[a-z0-9.-]+\.mzstatic\.com\//i.test(art)) { return; }
        cover = art;
        document.documentElement.style.setProperty('--moode-cover', 'url("' + art.replace(/"/g, '') + '")');
    });
}());
