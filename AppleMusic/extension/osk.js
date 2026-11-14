// On-screen keyboard for Apple Music on the Pi's touch display: search, and
// Apple's sign-in window (also in its idmsa.apple.com frame). Shown when a
// text field gets focus, only while moOde's "Popup keyboard" setting
// (Configure > Peripherals) is on. Keys are typed straight into the focused
// field; nothing typed here leaves the page.
(function () {
    'use strict';

    var LAYOUTS = {
        lower: [
            ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'BACK'],
            ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
            ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', '@'],
            ['SHIFT', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '.', '-'],
            ['SYM', 'SPACE', 'ENTER', 'HIDE']
        ],
        upper: [
            ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'BACK'],
            ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
            ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', '@'],
            ['SHIFT', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', '.', '-'],
            ['SYM', 'SPACE', 'ENTER', 'HIDE']
        ],
        symbols: [
            ['!', '#', '$', '%', '&', '*', '(', ')', '=', '+', 'BACK'],
            ['_', '/', '\\', '|', '~', '^', '[', ']', '{', '}'],
            [':', ';', '"', "'", '`', '<', '>', '?', ',', '@'],
            ['SHIFT', '€', '£', '¥', '§', '°', '&', '+', '.', '-'],
            ['ABC', 'SPACE', 'ENTER', 'HIDE']
        ]
    };
    var LABELS = { BACK: '⌫', SHIFT: '⇧', SYM: '?123', ABC: 'ABC', SPACE: ' ', ENTER: '⏎', HIDE: '⌄' };

    var enabled = false;
    var board = null;
    var layout = 'lower';
    var shiftOnce = false;
    var target = null;

    function editable(el) {
        if (!el || !el.tagName) { return false; }
        if (el.isContentEditable) { return true; }
        if (el.tagName === 'TEXTAREA') { return !el.readOnly && !el.disabled; }
        if (el.tagName !== 'INPUT' || el.readOnly || el.disabled) { return false; }
        return ['text', 'search', 'email', 'password', 'tel', 'url', 'number', ''].indexOf((el.type || '').toLowerCase()) !== -1;
    }

    // The focused element, also inside shadow DOM.
    function focused() {
        var el = document.activeElement;
        while (el && el.shadowRoot && el.shadowRoot.activeElement) { el = el.shadowRoot.activeElement; }
        return el;
    }

    function build() {
        board = document.createElement('div');
        board.id = 'moode-osk';
        board.setAttribute('aria-hidden', 'true');
        // Keys must not take the focus away from the text field.
        board.addEventListener('pointerdown', function (ev) {
            ev.preventDefault();
            var key = ev.target.closest('[data-key]');
            if (key) { press(key.getAttribute('data-key')); }
        });
        board.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
        render();
        document.documentElement.appendChild(board);
    }

    function render() {
        board.replaceChildren();
        LAYOUTS[layout].forEach(function (row) {
            var r = document.createElement('div');
            r.className = 'moode-osk-row';
            row.forEach(function (k) {
                var b = document.createElement('div');
                b.className = 'moode-osk-key moode-osk-' + (LABELS[k] !== undefined ? k.toLowerCase() : 'char');
                if (k === 'SHIFT' && layout === 'upper') { b.className += ' moode-osk-active'; }
                b.setAttribute('data-key', k);
                b.textContent = LABELS[k] !== undefined ? LABELS[k] : k;
                r.appendChild(b);
            });
            board.appendChild(r);
        });
    }

    function insert(text) {
        var el = target || focused();
        if (!editable(el)) { return; }
        if (document.activeElement !== el && el.focus) { el.focus(); }
        // insertText behaves like real typing (input events, undo).
        if (!document.execCommand('insertText', false, text)) {
            var start = el.selectionStart, end = el.selectionEnd;
            el.value = el.value.slice(0, start) + text + el.value.slice(end);
            el.selectionStart = el.selectionEnd = start + text.length;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    function enter() {
        var el = target || focused();
        if (!el) { return; }
        var opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
        var handled = !el.dispatchEvent(new KeyboardEvent('keydown', opts));
        el.dispatchEvent(new KeyboardEvent('keypress', opts));
        el.dispatchEvent(new KeyboardEvent('keyup', opts));
        if (!handled && el.form && el.form.requestSubmit) {
            try { el.form.requestSubmit(); } catch (e) { /* no submit button */ }
        }
    }

    function press(k) {
        switch (k) {
            case 'BACK': document.execCommand('delete'); return;
            case 'SHIFT':
                layout = layout === 'upper' ? 'lower' : 'upper';
                shiftOnce = layout === 'upper';
                render();
                return;
            case 'SYM': layout = 'symbols'; render(); return;
            case 'ABC': layout = 'lower'; render(); return;
            case 'SPACE': insert(' '); return;
            case 'ENTER': enter(); return;
            case 'HIDE': hide(); if (target && target.blur) { target.blur(); } return;
        }
        insert(k);
        if (shiftOnce) { shiftOnce = false; layout = 'lower'; render(); }
    }

    function show(el) {
        target = el;
        if (!board) { build(); }
        board.classList.add('moode-osk-visible');
        document.documentElement.classList.add('moode-osk-open');
        setTimeout(function () {
            if (el.scrollIntoView) { el.scrollIntoView({ block: 'center', behavior: 'auto' }); }
        }, 50);
    }

    function hide() {
        if (!board) { return; }
        board.classList.remove('moode-osk-visible');
        document.documentElement.classList.remove('moode-osk-open');
        target = null;
    }

    document.addEventListener('focusin', function () {
        if (!enabled) { return; }
        var el = focused();
        if (editable(el)) { show(el); }
    }, true);
    document.addEventListener('focusout', function () {
        setTimeout(function () {
            if (!editable(focused())) { hide(); }
        }, 150);
    }, true);

    // moOde's "Popup keyboard" setting, refreshed now and then.
    function load() {
        try {
            chrome.runtime.sendMessage({ type: 'moode-osk' }, function (res) {
                if (chrome.runtime.lastError) { return; }
                enabled = !!(res && res.osk);
                if (!enabled) { hide(); } else if (editable(focused())) { show(focused()); }
            });
        } catch (e) { /* extension reloading */ }
    }
    load();
    setInterval(load, 30000);
}());
