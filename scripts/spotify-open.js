// spotify-open.js — "Open in Spotify" buttons for full-length playback.
//
// The embedded player only plays previews unless the browser is signed in to
// Spotify, and a site added to the home screen runs in its own browser (on iPhone it
// doesn't share Safari's Spotify sign-in, and there are no other tabs). These buttons
// hand the song, album or artist to the Spotify app instead, using Spotify's public
// links, so no sign-in or extra API access is needed.
//
//  • In a normal browser tab: a plain https://open.spotify.com link. Phones with the
//    Spotify app open it in the app; otherwise Spotify's web player opens.
//  • In the home-screen app on a phone: Spotify's spotify: app link, which opens the
//    app directly (iOS doesn't reliably pass https links to apps from home-screen web
//    apps). If the app hasn't opened after a moment, the web player opens instead.
import { esc } from "./auth.js";

const TYPES = new Set(["track", "album", "artist"]);

const PLAY_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="#1ed760"/><path d="M6.4 4.8v6.4L11.3 8z" fill="#000"/></svg>`;

// HTML for an "Open in Spotify" link, or "" if the type or id isn't usable.
export function openInSpotifyHtml(type, id, { label = "Open in Spotify" } = {}) {
    if (!TYPES.has(type) || !/^[A-Za-z0-9]+$/.test(String(id || ""))) return "";
    return `<a class="open-spotify" href="https://open.spotify.com/${type}/${id}" data-spotify-uri="spotify:${type}:${id}"
        target="_blank" rel="noopener" aria-label="${esc(label)} (opens Spotify)">${PLAY_ICON}<span>${esc(label)}</span></a>`;
}

const isHomeScreenApp = () =>
    window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
const isTouchDevice = () => window.matchMedia?.("(pointer: coarse)").matches;

document.addEventListener("click", e => {
    const link = e.target.closest?.("a.open-spotify[data-spotify-uri]");
    if (!link || !isHomeScreenApp() || !isTouchDevice()) return;   // normal tabs: plain link

    e.preventDefault();
    e.stopPropagation();
    let appOpened = false;
    const onHide = () => { if (document.visibilityState === "hidden") appOpened = true; };
    document.addEventListener("visibilitychange", onHide);
    window.location.href = link.dataset.spotifyUri;
    setTimeout(() => {
        document.removeEventListener("visibilitychange", onHide);
        if (!appOpened) window.location.href = link.href;   // no Spotify app: web player
    }, 1500);
});
