// recommended-rankings.js — "Recommended for you" on rankings.html: rankings the
// signed-in user hasn't made yet, worked out from the ones they have, shown as the same
// cover cards as their saved rankings. In order of priority:
//   1. albums from an artist's Albums & EPs ranking that have no album ranking yet;
//   2. artists whose albums they've ranked but who have no artist ranking yet;
//   3. albums by artists whose top tracks they've ranked, not ranked yet;
//   4. artists similar to their favourite artists (Last.fm artist.getSimilar);
//   5. the best-known album by some of those similar artists (Last.fm artist.getTopAlbums).
// Nothing already ranked is suggested. The result is cached in localStorage for an
// hour (tunevis_recs_cache), keyed by the user's rankings, so the page doesn't call the
// APIs on every visit. Every lookup is optional: a failure just means fewer cards.
import { esc, getSpotifyToken } from "./auth.js";
import { onUserChange } from "./supabase.js";
import { listRankings } from "./saved-rankings.js";
import { albumArtists, artistAverages } from "./artist-ratings.js";
import { loopCarousel } from "./loop-carousel.js";
import { albumKey } from "./album-editions.js";

const LASTFM_API_KEY = "2e23f6b1b4b3345ab5e33a788a072303";
const CACHE_KEY = "tunevis_recs_cache";
const CACHE_TTL = 60 * 60 * 1000;
const MAX_CARDS = 8;
// How many of each kind, so one kind can't fill the whole list.
const LIMITS = { missingAlbum: 3, missingArtist: 3, artistAlbum: 2, similarArtist: 3, similarAlbum: 2 };

const section = document.getElementById("recommended-rankings");
const gridEl = document.getElementById("recommended-list");

// ── API helpers ────────────────────────────────────────────────────────
async function spotifyGet(url) {
    let token = await getSpotifyToken();
    let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) {                     // stale token: refresh once and retry
        token = await getSpotifyToken(true);
        res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    }
    if (!res.ok) throw new Error(`Spotify ${res.status}`);
    return res.json();
}

async function lastfm(method, params) {
    const url = new URL("https://ws.audioscrobbler.com/2.0/");
    url.searchParams.set("method", method);
    url.searchParams.set("api_key", LASTFM_API_KEY);
    url.searchParams.set("format", "json");
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Last.fm ${res.status}`);
    return res.json();
}

const quiet = promise => promise.catch(err => { console.warn("[recs]", err); return null; });
const imageOf = obj => obj?.images?.[1]?.url || obj?.images?.[0]?.url || "";
const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// Artists by id, 50 at a time: [{ id, name, image }].
async function artistsById(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
        const data = await quiet(spotifyGet(`https://api.spotify.com/v1/artists?ids=${ids.slice(i, i + 50).map(encodeURIComponent).join(",")}`));
        for (const a of data?.artists || []) if (a?.id) out.push({ id: a.id, name: a.name, image: imageOf(a) });
    }
    return out;
}

// The Spotify artist for a name from Last.fm (exact name match only, to avoid
// suggesting a different artist with a similar name).
async function findArtist(name) {
    const url = new URL("https://api.spotify.com/v1/search");
    url.searchParams.set("q", name);
    url.searchParams.set("type", "artist");
    url.searchParams.set("limit", "5");
    const data = await quiet(spotifyGet(url.toString()));
    const hit = (data?.artists?.items || []).find(a => sameName(a.name, name));
    return hit ? { id: hit.id, name: hit.name, image: imageOf(hit) } : null;
}

async function findAlbum(title, artistName) {
    const url = new URL("https://api.spotify.com/v1/search");
    url.searchParams.set("q", `album:${title} artist:${artistName}`);
    url.searchParams.set("type", "album");
    url.searchParams.set("limit", "5");
    url.searchParams.set("market", "GB");
    const data = await quiet(spotifyGet(url.toString()));
    const hit = (data?.albums?.items || []).find(a => a.album_type === "album") || data?.albums?.items?.[0];
    return hit ? { id: hit.id, name: hit.name, image: imageOf(hit), artist: hit.artists?.[0]?.name || artistName } : null;
}

// ── Working out the suggestions ───────────────────────────────────────
const artistUrl = (id, albums) => `rank.html?type=artist&id=${encodeURIComponent(id)}${albums ? "&list=albums" : ""}`;
const albumUrl = id => `rank.html?type=album&id=${encodeURIComponent(id)}`;

async function buildRecommendations(rankings) {
    const rankedAlbums = new Set(rankings.filter(r => r.kind === "album").map(r => r.source_id));
    // By name too, so another edition of an album you've ranked (deluxe vs standard)
    // isn't suggested.
    const rankedAlbumNames = new Set(rankings.filter(r => r.kind === "album").map(r => albumKey(r.source_name || r.title)));
    const rankedArtists = new Set(rankings.filter(r => r.kind === "artist" || r.kind === "artist_albums").map(r => r.source_id));
    const cards = [];
    const usedAlbums = new Set(), usedArtists = new Set();
    let group = "missingAlbum";   // which kind of suggestion the add* calls are making
    const addAlbum = card => {
        if (!card.id || rankedAlbums.has(card.id) || usedAlbums.has(card.id)) return false;
        if (card.name && rankedAlbumNames.has(albumKey(card.name))) return false;
        usedAlbums.add(card.id);
        cards.push({ ...card, group, href: albumUrl(card.id), round: false });
        return true;
    };
    const addArtist = (card, albums) => {
        if (!card.id || rankedArtists.has(card.id) || usedArtists.has(card.id)) return false;
        usedArtists.add(card.id);
        cards.push({ ...card, group, href: artistUrl(card.id, albums), round: true });
        return true;
    };

    // 1. Albums in an artist's Albums & EPs ranking with no album ranking of their own.
    let n = 0;
    for (const r of rankings.filter(r => r.kind === "artist_albums")) {   // newest first
        for (const item of r.items || []) {
            if (n >= LIMITS.missingAlbum) break;
            if (addAlbum({ id: item.id, name: item.name, image: item.image, reason: `From your ${r.source_name || "artist"} albums ranking` })) n++;
        }
    }

    // 2. Artists of ranked albums who have no artist ranking yet (most-rated first).
    group = "missingArtist";
    const albumRankings = rankings.filter(r => r.kind === "album" && r.source_id);
    const credits = albumRankings.length ? await quiet(albumArtists(albumRankings.map(r => r.source_id))) : null;
    const albumsByArtist = new Map();   // artistId → [album titles]
    for (const r of albumRankings) {
        for (const artistId of credits?.[r.source_id] || []) {
            if (!albumsByArtist.has(artistId)) albumsByArtist.set(artistId, []);
            albumsByArtist.get(artistId).push(r.source_name || r.title);
        }
    }
    const unranked = [...albumsByArtist.entries()]
        .filter(([id]) => !rankedArtists.has(id))
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, LIMITS.missingArtist);
    const unrankedInfo = await artistsById(unranked.map(([id]) => id));
    for (const [id, titles] of unranked) {
        const a = unrankedInfo.find(x => x.id === id);
        if (!a) continue;
        addArtist({ id, name: a.name, image: a.image,
            reason: titles.length > 1 ? `You've ranked ${titles.length} of their albums` : `You ranked ${titles[0]}` }, true);
    }

    // 3. Albums by artists whose top tracks are ranked: their newest album not ranked.
    group = "artistAlbum";
    n = 0;
    for (const r of rankings.filter(r => r.kind === "artist").slice(0, 4)) {
        if (n >= LIMITS.artistAlbum) break;
        const data = await quiet(spotifyGet(`https://api.spotify.com/v1/artists/${encodeURIComponent(r.source_id)}/albums?include_groups=album&market=GB&limit=10`));
        const album = (data?.items || []).find(a => !rankedAlbums.has(a.id) && !usedAlbums.has(a.id));
        if (album && addAlbum({ id: album.id, name: album.name, image: imageOf(album), reason: `By ${r.source_name || "an artist you ranked"}` })) n++;
    }

    // 4–5. Similar artists to the user's favourites: highest average stars first, then
    // the artists they've ranked most recently.
    const averages = await quiet(artistAverages(rankings)) || new Map();
    const names = new Map();   // artistId → name
    rankings.filter(r => r.kind === "artist" || r.kind === "artist_albums").forEach(r => names.set(r.source_id, r.source_name));
    unrankedInfo.forEach(a => names.set(a.id, a.name));
    const seeds = [...names.keys()]
        .sort((a, b) => (averages.get(b)?.average ?? 0) - (averages.get(a)?.average ?? 0))
        .slice(0, 3)
        .map(id => names.get(id))
        .filter(Boolean);

    group = "similarArtist";
    const similarFound = [];
    for (const seed of seeds) {
        if (similarFound.length >= LIMITS.similarArtist) break;
        const data = await quiet(lastfm("artist.getSimilar", { artist: seed, limit: "8", autocorrect: "1" }));
        for (const s of data?.similarartists?.artist || []) {
            if (similarFound.length >= LIMITS.similarArtist) break;
            if ([...names.values()].some(nm => sameName(nm, s.name))) continue;
            const a = await findArtist(s.name);
            if (a && addArtist({ id: a.id, name: a.name, image: a.image, reason: `Similar to ${seed}` }, false)) {
                similarFound.push({ ...a, seed });
                break;   // one per seed, so the list covers several of their favourites
            }
        }
    }

    group = "similarAlbum";
    n = 0;
    for (const a of similarFound) {
        if (n >= LIMITS.similarAlbum) break;
        const data = await quiet(lastfm("artist.getTopAlbums", { artist: a.name, limit: "3", autocorrect: "1" }));
        const top = (data?.topalbums?.album || []).find(x => x?.name && x.name !== "(null)");
        if (!top) continue;
        const album = await findAlbum(top.name, a.name);
        if (album && addAlbum({ id: album.id, name: album.name, image: album.image, reason: `${album.artist} · similar to ${a.seed}` })) n++;
    }

    return pickVaried(cards);
}

// Up to MAX_CARDS, taking one of each kind in turn (in priority order) so the list mixes
// gaps in what's ranked with new artists and albums to discover.
function pickVaried(cards) {
    const groups = Object.keys(LIMITS).map(g => cards.filter(c => c.group === g));
    const out = [];
    for (let round = 0; out.length < MAX_CARDS && groups.some(g => g.length > round); round++) {
        for (const g of groups) if (g[round] && out.length < MAX_CARDS) out.push(g[round]);
    }
    return out;
}

// ── Cache ─────────────────────────────────────────────────────────────
// Keyed by the user and their rankings, so any save, edit or delete works it out again.
const signature = (userId, rankings) =>
    userId + "|" + rankings.map(r => `${r.id}:${r.updated_at}`).join(",");

function readCache(sig) {
    try {
        const c = JSON.parse(localStorage.getItem(CACHE_KEY));
        return c && c.sig === sig && Date.now() - c.at < CACHE_TTL ? c.cards : null;
    } catch { return null; }
}

function writeCache(sig, cards) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ sig, at: Date.now(), cards })); } catch {}
}

// ── Rendering ─────────────────────────────────────────────────────────
// Same cards as the saved rankings grid (rankings-library.js), with the reason
// for the suggestion where saved cards show their stars.
function cardHtml(c) {
    return `
        <a class="saved-card suggest-card" href="${esc(c.href)}">
            <span class="saved-card-cover${c.round ? " round" : ""}">
                ${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy">` : `<span class="saved-card-placeholder" aria-hidden="true">${esc((c.name || "?").trim().charAt(0).toUpperCase())}</span>`}
            </span>
            <span class="saved-card-name">${esc(c.name)}</span>
            <span class="saved-card-sub">${c.round ? "Artist" : "Album"}</span>
            <span class="suggest-card-reason">${esc(c.reason)}</span>
        </a>`;
}

function showLoading() {
    section.hidden = false;
    loopCarousel(gridEl, { items: [], build: cardElement });   // no looping while loading
    gridEl.innerHTML = Array.from({ length: 4 }, () => `
        <span class="saved-card suggest-card-loading" aria-hidden="true">
            <span class="saved-card-cover"></span>
            <span class="suggest-loading-line"></span>
            <span class="suggest-loading-line short"></span>
        </span>`).join("");
    gridEl.setAttribute("aria-busy", "true");
}

let loadId = 0;
async function load(user) {
    if (!section) return;
    const id = ++loadId;
    if (!user) { section.hidden = true; return; }
    let rankings;
    try {
        rankings = (await listRankings()) || [];
    } catch (err) {
        console.warn("[recs]", err);
        section.hidden = true;
        return;
    }
    if (id !== loadId) return;
    // Nothing to go on yet: the search box and the saved rankings section say what to do.
    if (!rankings.some(r => r.kind === "album" || r.kind === "artist" || r.kind === "artist_albums")) {
        section.hidden = true;
        return;
    }

    const sig = signature(user.id, rankings);
    let cards = readCache(sig);
    if (!cards) {
        showLoading();
        cards = await buildRecommendations(rankings).catch(err => { console.warn("[recs]", err); return []; });
        if (id !== loadId) return;
        if (cards.length) writeCache(sig, cards);
    }
    gridEl.removeAttribute("aria-busy");
    section.hidden = !cards.length;
    shownCards = cards;
    renderCards();
}

// All the suggestions in one row that scrolls round and round (loop-carousel.js).
let shownCards = [];

function cardElement(c) {
    const holder = document.createElement("div");
    holder.innerHTML = cardHtml(c).trim();
    return holder.firstElementChild;
}

function renderCards() {
    loopCarousel(gridEl, {
        items: shownCards,
        build: cardElement,
        leftBtn: document.getElementById("recommended-left"),
        rightBtn: document.getElementById("recommended-right"),
    });
}

let currentUser = null;
onUserChange(user => { currentUser = user; load(user); });
// Back from a ranking that was just saved: the suggestions may have changed.
window.addEventListener("pageshow", e => { if (e.persisted && currentUser) load(currentUser); });
