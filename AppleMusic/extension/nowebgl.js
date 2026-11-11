// Runs in the page itself (world MAIN). Apple Music draws an animated WebGL
// backdrop behind the full-screen player at ~40 fps, which costs most of the
// Pi's CPU. Refusing WebGL makes it fall back to a static background.
(function () {
    'use strict';
    var proto = HTMLCanvasElement.prototype;
    var original = proto.getContext;
    proto.getContext = function (type) {
        if (typeof type === 'string' && /webgl/i.test(type)) { return null; }
        return original.apply(this, arguments);
    };
}());
