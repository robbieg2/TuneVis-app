// ranking-cards.js — the cover card for a saved ranking: large square cover (round for
// artists), its name, a short line about it and its stars. Used by the saved rankings
// grid (rankings-library.js), friends' profiles (profile.js) and the feed (social.js).
import { esc } from "./auth.js";
import { rankingUrl, KIND_LABELS } from "./saved-rankings.js";
import { starsHtml, formatRating } from "./star-rating.js";
import { formatAverage } from "./artist-ratings.js";

export const isArtistKind = r => r.kind === "artist" || r.kind === "artist_albums";

// What the grids show: albums and custom rankings as they are, and each artist's top
// tracks and albums & EPs rankings together as one entry:
// { group: true, id, source_id, title, image, updated_at, pinned_at, tracks, albums, rankings }.
// list is newest first, so tracks / albums are the newest of each.
export function groupArtists(list) {
    const out = [];
    const byArtist = new Map();
    for (const r of list) {
        if (!isArtistKind(r)) { out.push(r); continue; }
        let g = byArtist.get(r.source_id);
        if (!g) {
            g = { group: true, id: `artist:${r.source_id}`, kind: "artist_group", source_id: r.source_id,
                  source_name: r.source_name, title: r.source_name || r.title, image: r.image,
                  user_id: r.user_id, updated_at: r.updated_at, pinned_at: null,
                  tracks: null, albums: null, rankings: [] };
            byArtist.set(r.source_id, g);
            out.push(g);
        }
        g.rankings.push(r);
        if (r.kind === "artist" && !g.tracks) g.tracks = r;
        if (r.kind === "artist_albums" && !g.albums) g.albums = r;
        if (!g.image && r.image) g.image = r.image;
        if (String(r.updated_at) > String(g.updated_at)) g.updated_at = r.updated_at;
        if (r.pinned_at && (!g.pinned_at || r.pinned_at > g.pinned_at)) g.pinned_at = r.pinned_at;
    }
    return out;
}

// An artist's card: opens their newest ranking, where a switch moves between Top
// tracks and Albums & EPs.
function artistCard(g, { averages, friend }) {
    const card = document.createElement("a");
    card.className = "saved-card";
    card.href = rankingUrl(g.rankings[0], { friend });
    const parts = [];
    if (g.tracks) parts.push(`${g.tracks.item_ids?.length || 0} tracks`);
    if (g.albums) parts.push(`${g.albums.item_ids?.length || 0} albums`);
    let starsLine = "";
    if (averages.has(g.source_id)) {
        const { average, count } = averages.get(g.source_id);
        starsLine = `<span class="saved-card-stars" title="Average of ${count} rated album${count === 1 ? "" : "s"}">${starsHtml(average, { size: 14 })}<span>${formatAverage(average)} avg</span></span>`;
    }
    card.innerHTML = `
        <span class="saved-card-cover round">
            ${g.image ? `<img src="${esc(g.image)}" alt="" loading="lazy">` : `<span class="saved-card-placeholder" aria-hidden="true">${esc((g.title || "?").trim().charAt(0).toUpperCase())}</span>`}
        </span>
        <span class="saved-card-name">${esc(g.title)}</span>
        <span class="saved-card-sub">${esc(parts.join(" · "))}</span>
        ${starsLine}`;
    return card;
}

// averages: Map artistId → { average, count } (artistAverages()) for artists' stars.
// friend: someone else's ranking, so it opens read-only.
export function rankingCard(r, { averages = new Map(), friend = false } = {}) {
    if (r.group) return artistCard(r, { averages, friend });
    const card = document.createElement("a");
    card.className = "saved-card";
    card.href = rankingUrl(r, { friend });
    const count = r.item_ids?.length || 0;
    const round = ["artist", "artist_albums", "fav_artists"].includes(r.kind) ? " round" : "";

    let about;
    if (r.kind === "album") {
        about = [r.source_name && r.source_name !== r.title ? r.source_name : null,
            count ? `${count} ranked` : "Rated only"];
    } else if (isArtistKind(r)) {
        about = [r.source_name && r.source_name !== r.title ? r.source_name : null,
            count ? `${count} ranked` : null];
    } else {
        about = [KIND_LABELS[r.kind], count ? `${count} ranked` : null];
    }
    const aboutText = about.filter(Boolean).join(" · ");

    let starsLine = "";
    if (r.kind === "album" && r.rating != null) {
        const rating = Number(r.rating);
        starsLine = `<span class="saved-card-stars">${starsHtml(rating, { size: 14 })}<span>${formatRating(rating)}</span></span>`;
    } else if (isArtistKind(r) && averages.has(r.source_id)) {
        const { average, count: rated } = averages.get(r.source_id);
        starsLine = `<span class="saved-card-stars" title="Average of ${rated} rated album${rated === 1 ? "" : "s"}">${starsHtml(average, { size: 14 })}<span>${formatAverage(average)} avg</span></span>`;
    }

    card.innerHTML = `
        <span class="saved-card-cover${round}">
            ${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : `<span class="saved-card-placeholder" aria-hidden="true">${esc((r.title || "?").trim().charAt(0).toUpperCase())}</span>`}
        </span>
        <span class="saved-card-name">${esc(r.title)}</span>
        ${aboutText ? `<span class="saved-card-sub">${esc(aboutText)}</span>` : ""}
        ${starsLine}`;
    return card;
}
