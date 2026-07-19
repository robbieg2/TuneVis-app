// features-data.js
export const RECCOBEATS_BASE = "https://api.reccobeats.com/v1";
export const LASTFM_BASE = "https://ws.audioscrobbler.com/2.0/";

// Cache audio features by Spotify track ID
const audioFeatureCache = new Map();

// Spotify helpers
export function uniq(arr) {
    return [...new Set((arr || []).filter(Boolean))];
}

export function extractSpotifyIdFromHref(href) {
    if (!href) return null;
    const match = String(href).match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/);
    return match ? match[1] : null;
}

function spotifySearchEscape(s) {
    return String(s || "")
        .replace(/"/g, '\\"')
        .replace(/\s+/g, " ")
        .trim();
}

export async function spotifyFetch(token, url) {
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Spotify fetch failed: ${res.status} ${text}`);
    }

    return res.json();
}

// Get audio features from ReccoBeats
export async function getTrackFeaturesFromReccoBeats(spotifyTrackId) {
    if (!spotifyTrackId) return null;
    if (audioFeatureCache.has(spotifyTrackId)) {
		return audioFeatureCache.get(spotifyTrackId);
	}

    const url = `${RECCOBEATS_BASE}/audio-features?ids=${encodeURIComponent(spotifyTrackId)}`;
    const res = await fetch(url);

    if (res.status === 429) {
        const retryAfter = res.headers.get("Retry-After");
        throw new Error(`Rate limited (429). Retry after: ${retryAfter || "unknown"}s`);
    }

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`ReccoBeats audio-features failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    const list = data?.content;

    const features = Array.isArray(list) && list[0] ? list[0] : null;
    if (features) audioFeatureCache.set(spotifyTrackId, features);
     
	return features;
}

export async function getManyFeaturesFromReccoBeats(spotifyIds) {
    const ids = uniq(spotifyIds);
    if (!ids.length) return new Map();

    const url = `${RECCOBEATS_BASE}/audio-features?ids=${encodeURIComponent(ids.join(","))}`;
    const res = await fetch(url);

    if (res.status === 429) {
        const retryAfter = res.headers.get("Retry-After");
        throw new Error(`Rate limited (429). Retry after: ${retryAfter || "unknown"}s`);
    }

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`ReccoBeats multi audio-features failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    const list = Array.isArray(data?.content) ? data.content : [];

    const map = new Map();
    list.forEach((f) => {
        const spotifyId = extractSpotifyIdFromHref(f?.href);
        if (spotifyId) map.set(spotifyId, f);
    });

    return map;
}

// Get similar tracks from Last.fm API
export async function lastfmGetSimilarTracks({ apiKey, artist, track, limit = 50 }) {
    if (!apiKey) throw new Error("Last.fm key missing");
	
	const a = String(artist || "").trim();
	const t = String(track || "").trim();
    if (!a || !t) return [];

    const url = new URL(LASTFM_BASE);
    url.searchParams.set("method", "track.getSimilar");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("artist", a);
    url.searchParams.set("track", t);
    url.searchParams.set("autocorrect", "1");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("format", "json");

    const res = await fetch(url.toString());
    const data = await res.json();

    if (!res.ok || data?.error) {
        throw new Error(`Last.fm getSimilar failed: ${data?.message || res.status}`);
    }

    const raw = data?.similartracks?.track;
    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];

    return items
        .map((t) => ({
            name: (t?.name || "").trim(),
            artist: (t?.artist?.name || t?.artist || "").trim(),
            match: Number(t?.match ?? 0),
        }))
        .filter((t) => t.name && t.artist);
}

// Fallback: Get similar artists if similar songs is unavailable
export async function lastfmGetSimilarArtists({ apiKey, artist, limit = 10 }) {
    if (!apiKey) throw new Error("Last.fm key missing");
	if (!artist) return [];

    const url = new URL(LASTFM_BASE);
    url.searchParams.set("method", "artist.getSimilar");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("artist", artist);
    url.searchParams.set("autocorrect", "1");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("format", "json");

    const res = await fetch(url.toString());
    const data = await res.json();

    if (!res.ok || data?.error) {
        throw new Error(`Last.fm artist.getSimilar failed: ${data?.message || res.status}`);
    }

    const raw = data?.similarartists?.artist;
    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];

    return items
        .map(a => ({
            name: (a?.name || "").trim(),
            match: Number(a?.match ?? 0),
        }))
        .filter(a => a.name);
}

// Fallback: Get similar artists top tracks if similar songs is unavailable
export async function lastfmGetArtistTopTracks({ apiKey, artist, limit = 10 }) {
    if (!apiKey) throw new Error("Last.fm key missing");
	if (!artist) return [];

    const url = new URL(LASTFM_BASE);
    url.searchParams.set("method", "artist.getTopTracks");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("artist", artist);
    url.searchParams.set("autocorrect", "1");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("format", "json");

    const res = await fetch(url.toString());
    const data = await res.json();

    if (!res.ok || data?.error) {
        throw new Error(`Last.fm artist.getTopTracks failed: ${data?.message || res.status}`);
    }

    const raw = data?.toptracks?.track;
    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];

    return items
        .map(t => ({
            name: (t?.name || "").trim(),
            artist: (t?.artist?.name || t?.artist || "").trim(),
        }))
        .filter(t => t.name && t.artist);
}

export async function spotifyResolveTrackId(token, { name, artist, market = "GB" }) {
    if (!name || !artist) return null;

    const q = `track:"${spotifySearchEscape(name)}" artist:"${spotifySearchEscape(artist)}"`;
    const url = new URL("https://api.spotify.com/v1/search");
    url.searchParams.set("type", "track");
    url.searchParams.set("limit", "1");
    url.searchParams.set("market", market);
    url.searchParams.set("q", q);

    const data = await spotifyFetch(token, url.toString());
    return data?.tracks?.items?.[0]?.id || null;
}

export async function spotifyResolveManyTrackIds(token, pairs, { market = "GB", concurrency = 5 } = {}) {
    const list = Array.isArray(pairs) ? pairs : [];
    if (!list.length) return [];

    const results = [];
    let i = 0;

    async function worker() {
        while (i < list.length) {
            const idx = i++;
			const p = list[idx];
            try {
                const id = await spotifyResolveTrackId(token, { name: p?.name, artist: p?.artist, market });
                if (id) results.push(id);
            } catch {}
        }
    }

    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));

    return [...new Set(results)];
}

// Similarity scoring
export function similarityScore(seed, rec) {
    const keys = ["danceability", "energy", "valence", "speechiness", "acousticness", "instrumentalness"];

    let totalDifference = 0;
    let count = 0;

    for (const k of keys) {
        const a = Number(seed?.[k]);
        const b = Number(rec?.[k]);
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;

        totalDifference += Math.abs(a - b);
        count++;
    }

    if (count === 0) return 0;
    return 1 - totalDifference / count;
}

