// artist-ratings.js — an artist's average star rating: the mean of the user's star
// ratings for that artist's albums (saved album rankings with a rating).
//
// Album rankings store the album, not its artists, so which artists made an album is
// remembered per browser in localStorage (tunevis_album_artists: { albumId: [artistIds] }).
// It's filled whenever an album ranking page is opened, and any rated album not in it
// yet is looked up from Spotify in batches of 20. Album credits don't change, so the
// entries don't expire. Everything here is optional: on any failure the averages just
// leave those albums out.
import { getSpotifyToken } from "./auth.js";

const KEY = "tunevis_album_artists";
const MAX_ENTRIES = 2000;

function readCache() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch { return {}; }
}

function writeCache(cache) {
    try {
        const ids = Object.keys(cache);
        if (ids.length > MAX_ENTRIES) ids.slice(0, ids.length - MAX_ENTRIES).forEach(id => delete cache[id]);
        localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {}
}

// Called by the album ranking page, which already knows the album's artists.
export function rememberAlbumArtists(albumId, artistIds) {
    if (!albumId || !artistIds?.length) return;
    const cache = readCache();
    cache[albumId] = artistIds;
    writeCache(cache);
}

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

async function lookUp(albumIds, cache) {
    for (let i = 0; i < albumIds.length; i += 20) {
        const batch = albumIds.slice(i, i + 20);
        try {
            const data = await spotifyGet(`https://api.spotify.com/v1/albums?ids=${batch.map(encodeURIComponent).join(",")}&market=GB`);
            for (const album of data.albums || []) {
                if (album?.id) cache[album.id] = (album.artists || []).map(a => a.id).filter(Boolean);
            }
        } catch (err) {
            console.warn("[ratings] Couldn't look up album artists:", err);
            break;
        }
    }
    writeCache(cache);
}

// { albumId: [artistIds] } for these albums, looking up any not known yet.
export async function albumArtists(albumIds) {
    const cache = readCache();
    const missing = [...new Set(albumIds)].filter(id => id && !cache[id]);
    if (missing.length) await lookUp(missing, cache);
    return cache;
}

// rankings: the user's saved rankings (any kinds). Resolves to a Map of
// artistId → { average, count }, counting each album once (its newest rating).
export async function artistAverages(rankings) {
    const ratings = new Map();   // albumId → rating
    for (const r of rankings || []) {   // newest first
        if (r.kind === "album" && r.rating != null && r.source_id && !ratings.has(r.source_id)) {
            ratings.set(r.source_id, Number(r.rating));
        }
    }
    const cache = readCache();
    const missing = [...ratings.keys()].filter(id => !cache[id]);
    if (missing.length) await lookUp(missing, cache);

    const totals = new Map();   // artistId → { sum, count }
    for (const [albumId, rating] of ratings) {
        for (const artistId of cache[albumId] || []) {
            const t = totals.get(artistId) || { sum: 0, count: 0 };
            t.sum += rating;
            t.count += 1;
            totals.set(artistId, t);
        }
    }
    const out = new Map();
    for (const [id, { sum, count }] of totals) out.set(id, { average: sum / count, count });
    return out;
}

// "4.3" — averages are shown to one decimal place.
export const formatAverage = value => (Math.round(value * 10) / 10).toFixed(1);
