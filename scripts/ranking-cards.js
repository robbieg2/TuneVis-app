// ranking-cards.js — the cover card for a saved ranking: large square cover (round for
// artists), its name, a short line about it and its stars. Used by the saved rankings
// grid (rankings-library.js), friends' profiles (profile.js) and the feed (social.js).
import { esc } from "./auth.js";
import { rankingUrl, KIND_LABELS } from "./saved-rankings.js";
import { starsHtml, formatRating } from "./star-rating.js";
import { formatAverage } from "./artist-ratings.js";

export const isArtistKind = r => r.kind === "artist" || r.kind === "artist_albums";

// averages: Map artistId → { average, count } (artistAverages()) for artists' stars.
// friend: someone else's ranking, so it opens read-only.
export function rankingCard(r, { averages = new Map(), friend = false } = {}) {
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
