// Closing every window ends this Chromium instance; moOde is visible again.
// Volume requests go to moOde's web server on the Pi itself.
var ENDPOINT = 'http://localhost/applemusic.php?cmd=volume';

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg) { return false; }
    if (msg.type === 'moode-close') {
        chrome.windows.getAll(function (windows) {
            windows.forEach(function (w) { chrome.windows.remove(w.id); });
        });
        return false;
    }
    if (msg.type === 'moode-get-volume' || msg.type === 'moode-set-volume') {
        var url = ENDPOINT;
        var opts = { cache: 'no-store' };
        if (msg.type === 'moode-set-volume') {
            url += '&level=' + encodeURIComponent(msg.level | 0);
            opts.method = 'POST';
        }
        fetch(url, opts)
            .then(function (r) { return r.json(); })
            .then(function (state) { sendResponse(state); })
            .catch(function () { sendResponse(null); });
        return true;
    }
    return false;
});
