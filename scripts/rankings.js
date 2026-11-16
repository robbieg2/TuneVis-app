// rankings.js — search for an artist or album, hand off to rank.html
import { getSpotifyToken, esc } from "./auth.js";
import { onUserChange } from "./supabase.js";
import { listRankings, deleteRanking, rankingUrl, KIND_LABELS } from "./saved-rankings.js";

const backBtn = document.getElementById("back-btn");
const searchInput = document.getElementById("rankings-search-input");
const searchBtn = document.getElementById("rankings-search-btn");
const resultsEl = document.getElementById("rankings-results");

if (backBtn) backBtn.addEventListener("click", () => history.back());

let token = null;

async function ensureToken() {
    if (token) return token;
    token = await getSpotifyToken();
    return token;
}

// A cached token can go stale on a long-open tab — Spotify Client
// Credentials tokens last ~1 hour. Self-heal once before giving up.
async function spotifyGet(url) {
    const t = await ensureToken();
    let res = await fetch(url, { headers: { Authorization: `Bearer ${t}` } });
    if (res.status === 401) {
        token = await getSpotifyToken(true);
        res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    }
    return res;
}

function resultCard({ type, id, name, subtitle, image }) {
    const card = document.createElement("div");
    card.className = "rank-result-card";
    card.innerHTML = `
        ${image ? `<img class="rank-result-img ${type === "artist" ? "round" : ""}" src="${esc(image)}" alt="">` : `<div class="rank-result-img rank-result-placeholder ${type === "artist" ? "round" : ""}"></div>`}
        <div class="rank-result-meta">
            <span class="rank-result-name">${esc(name)}</span>
            <span class="rank-result-sub">${esc(subtitle)}</span>
        </div>
    `;
    card.addEventListener("click", () => {
        window.location.href = `rank.html?type=${type}&id=${encodeURIComponent(id)}`;
    });
    return card;
}

let searchRequestId = 0;

async function doSearch(query) {
    resultsEl.innerHTML = `<p class="tab-loading">Searching…</p>`;
    const requestId = ++searchRequestId;

    try {
        const url = new URL("https://api.spotify.com/v1/search");
        url.searchParams.set("q", query);
        url.searchParams.set("type", "artist,album");
        // Fetch extra album results up front since many will be filtered out below
        url.searchParams.set("limit", "20");

        const res = await spotifyGet(url.toString());
        if (!res.ok) throw new Error(`Search failed: ${res.status}`);
        const data = await res.json();

        const MIN_ALBUM_TRACKS = 4;

        const artists = (data?.artists?.items || []).slice(0, 8);
        // Spotify tags most singles as album_type "single", but many artists now
        // release short multi-track "album" releases too — so filter on actual
        // track count rather than trusting album_type alone.
        const albums = (data?.albums?.items || [])
            .filter(al => (al.total_tracks || 0) >= MIN_ALBUM_TRACKS)
            .slice(0, 8);

        // A faster, more recent keystroke may have already resolved —
        // ignore this response if it's no longer the latest search in flight.
        if (requestId !== searchRequestId) return;

        resultsEl.innerHTML = "";

        if (!artists.length && !albums.length) {
            resultsEl.innerHTML = `<p class="tab-empty">No artists or albums found for "${esc(query)}"</p>`;
            return;
        }

        if (artists.length) {
            const group = document.createElement("div");
            group.className = "rank-result-group";
            group.innerHTML = `<h3 class="rank-result-group-title">Artists</h3>`;
            const grid = document.createElement("div");
            grid.className = "rank-result-grid";
            artists.forEach(a => {
                grid.appendChild(resultCard({
                    type: "artist",
                    id: a.id,
                    name: a.name,
                    subtitle: "Artist",
                    image: a.images?.[0]?.url || "",
                }));
            });
            group.appendChild(grid);
            resultsEl.appendChild(group);
        }

        if (albums.length) {
            const group = document.createElement("div");
            group.className = "rank-result-group";
            group.innerHTML = `<h3 class="rank-result-group-title">Albums</h3>`;
            const grid = document.createElement("div");
            grid.className = "rank-result-grid";
            albums.forEach(al => {
                grid.appendChild(resultCard({
                    type: "album",
                    id: al.id,
                    name: al.name,
                    subtitle: (al.artists || []).map(a => a.name).join(", "),
                    image: al.images?.[0]?.url || "",
                }));
            });
            group.appendChild(grid);
            resultsEl.appendChild(group);
        }
    } catch (err) {
        if (requestId !== searchRequestId) return;
        console.error(err);
        resultsEl.innerHTML = `<p class="tab-empty">Something went wrong searching. Try again.</p>`;
    }
}

let searchDebounce = null;

function triggerSearch() {
    clearTimeout(searchDebounce);
    const q = searchInput.value.trim();
    if (!q) return;
    doSearch(q);
}

if (searchBtn) searchBtn.addEventListener("click", triggerSearch);
if (searchInput) {
    searchInput.addEventListener("keydown", e => {
        if (e.key === "Enter") triggerSearch();
    });

    searchInput.addEventListener("input", () => {
        const q = searchInput.value.trim();
        clearTimeout(searchDebounce);

        if (q.length < 2) {
            resultsEl.innerHTML = "";
            return;
        }

        searchDebounce = setTimeout(() => doSearch(q), 300);
    });
}

// Browser back/forward cache restores the exact DOM snapshot, including
// whatever was typed into the search box — clear it so returning to this
// page via back/forward doesn't show stale leftover text.
window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
        if (searchInput) searchInput.value = "";
        if (resultsEl) resultsEl.innerHTML = "";
    }
});

// ── Saved rankings (TuneVis account) ──────────────────────────────────
const savedSection = document.getElementById("saved-rankings");
const savedList = document.getElementById("saved-rankings-list");

function savedRankingRow(r) {
    const row = document.createElement("div");
    row.className = "saved-ranking";
    const count = r.item_ids?.length || 0;
    const kindLabel = KIND_LABELS[r.kind] || "Ranking";
    const about = r.source_name ? ` · ${r.source_name}` : "";
    const updated = new Date(r.updated_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    const round = r.kind === "artist" || r.kind === "fav_artists" ? "border-radius:50%;" : "";
    row.innerHTML = `
        <a class="saved-ranking-open" href="${esc(rankingUrl(r))}">
            ${r.image ? `<img class="saved-ranking-img" style="${round}" src="${esc(r.image)}" alt="">` : `<div class="saved-ranking-img"></div>`}
            <div class="saved-ranking-meta">
                <span class="saved-ranking-name">${esc(r.title)}</span>
                <span class="saved-ranking-sub">${esc(kindLabel + about)} · ${count} ranked · ${esc(updated)}</span>
            </div>
        </a>
        <button type="button" class="saved-ranking-delete">Delete</button>
    `;
    row.querySelector(".saved-ranking-delete").addEventListener("click", async (e) => {
        if (!confirm(`Delete "${r.title}"? This can't be undone.`)) return;
        e.target.disabled = true;
        try {
            await deleteRanking(r.id);
            row.remove();
            if (!savedList.children.length) renderSavedEmpty();
        } catch (err) {
            console.error(err);
            e.target.disabled = false;
            alert("That ranking couldn't be deleted just now. Please try again.");
        }
    });
    return row;
}

function renderSavedEmpty() {
    savedList.innerHTML = `<p class="tab-empty">Nothing saved yet. Build a ranking and press Save to keep it here.</p>`;
}

let savedRequestId = 0;

async function loadSavedRankings(user) {
    if (!savedSection) return;
    const requestId = ++savedRequestId;
    if (!user) { savedSection.hidden = true; return; }

    savedSection.hidden = false;
    savedList.innerHTML = `<p class="tab-loading">Loading your rankings…</p>`;
    try {
        const rows = await listRankings();
        if (requestId !== savedRequestId) return;
        savedList.innerHTML = "";
        if (!rows?.length) renderSavedEmpty();
        else rows.forEach(r => savedList.appendChild(savedRankingRow(r)));
    } catch (err) {
        if (requestId !== savedRequestId) return;
        console.error(err);
        savedList.innerHTML = `<p class="tab-empty">Your saved rankings couldn't be loaded just now.</p>`;
    }
    // Linked from the account page as rankings.html#saved-rankings; the section only
    // appears once loaded, so scroll to it now.
    if (window.location.hash === "#saved-rankings") savedSection.scrollIntoView({ behavior: "smooth" });
}

onUserChange(loadSavedRankings);
