// genre-charts.js — what's popular in a genre right now, for the Discover page's
// Trending tab (home.js) and the custom rankings page's popular pool (rank-general.js).
//
// Last.fm's tag.getTopTracks / tag.getTopArtists are all-time lists ("Thriller",
// "Everlong"), so genre charts built on them never changed. Last.fm has no weekly chart
// per genre, so genres use Spotify instead: tracks with that genre released this year or
// last, sorted by Spotify's popularity score (which follows current listening), one song
// per artist so a single new album can't fill the list. "All genres" still uses
// Last.fm's weekly chart.chart.getTopTracks in the pages themselves.
import { getSpotifyToken } from "./auth.js";

// The site's genre values that Spotify's genre: filter spells differently (checked
// against the live API: "hip hop" and "rnb" return nothing).
const SPOTIFY_GENRES = { "hip hop": "hiphop", rnb: "r&b" };

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

// Slowed / sped-up / reverb edits ride along in genre results (often mislabelled), and
// aren't what's trending in the genre.
const EDIT = /\b(slowed|sped[\s-]?up|speed[\s-]?up|reverb|nightcore)\b/i;

// "Song (feat. X) - Remix" → "song": versions of the same song count once.
const songKey = t => `${String(t.name).toLowerCase().replace(/\s*[([].*$/, "").replace(/\s+-\s+.*$/, "").trim()}|${t.artists?.[0]?.id}`;

// Up to `limit` popular recent Spotify tracks in a genre (full Spotify track objects),
// most popular first, at most `perArtist` per lead artist.
export async function genreTrendingTracks(genre, { limit = 8, perArtist = 1 } = {}) {
    const year = new Date().getFullYear();
    const q = `genre:"${SPOTIFY_GENRES[genre] || genre}" year:${year - 1}-${year}`;
    const page = offset => {
        const url = new URL("https://api.spotify.com/v1/search");
        url.searchParams.set("q", q);
        url.searchParams.set("type", "track");
        url.searchParams.set("market", "GB");
        url.searchParams.set("limit", "50");
        url.searchParams.set("offset", String(offset));
        return spotifyGet(url.toString()).then(d => d?.tracks?.items || []).catch(() => []);
    };
    const items = (await Promise.all([page(0), page(50)])).flat().filter(t => t?.id);

    const seen = new Set();
    const perArtistCount = new Map();
    const out = [];
    for (const t of items.sort((a, b) => (b.popularity || 0) - (a.popularity || 0))) {
        const key = songKey(t);
        const artist = t.artists?.[0]?.id;
        if (EDIT.test(t.name) || seen.has(key) || (perArtistCount.get(artist) || 0) >= perArtist) continue;
        seen.add(key);
        perArtistCount.set(artist, (perArtistCount.get(artist) || 0) + 1);
        out.push(t);
        if (out.length >= limit) break;
    }
    return out;
}

// Up to `limit` artists behind a genre's popular recent tracks, most popular first:
// [{ id, name, image }].
export async function genreTrendingArtists(genre, { limit = 15 } = {}) {
    const tracks = await genreTrendingTracks(genre, { limit: limit * 2, perArtist: 1 });
    const ids = [...new Set(tracks.map(t => t.artists?.[0]?.id).filter(Boolean))].slice(0, limit);
    if (!ids.length) return [];
    const data = await spotifyGet(`https://api.spotify.com/v1/artists?ids=${ids.join(",")}`).catch(() => null);
    const byId = new Map((data?.artists || []).filter(Boolean).map(a => [a.id, a]));
    return ids.map(id => {
        const a = byId.get(id);
        const fromTrack = tracks.find(t => t.artists?.[0]?.id === id)?.artists?.[0];
        if (!a && !fromTrack) return null;
        return { id, name: a?.name || fromTrack.name, image: a?.images?.[0]?.url || "" };
    }).filter(Boolean);
}
