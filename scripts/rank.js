// rank.js — artist / album ranking workspace
import { getSpotifyToken } from "./auth.js";

const backBtn = document.getElementById("back-btn");
const shareBtn = document.getElementById("share-btn");
const loadingEl = document.getElementById("rank-page-loading");
const pageEl = document.getElementById("rank-page");
const headEl = document.getElementById("rank-head");
const filterEl = document.getElementById("rank-filter-toggle");
const trackListEl = document.getElementById("track-list");
const rankListEl = document.getElementById("rank-list");
const rankTitleEl = document.getElementById("rank-panel-ranking-title");
const playerWrapEl = document.getElementById("rank-player-wrap");
const clearRankBtn = document.getElementById("clear-rank-btn");
const trackSearchEl = document.getElementById("track-search");
const trackSearchInput = document.getElementById("track-search-input");
const trackSearchBtn = document.getElementById("track-search-btn");
const trackSearchSuggestions = document.getElementById("track-search-suggestions");
let cachedToken = null;
let suggestDebounce = null;

if (backBtn) backBtn.addEventListener("click", () => history.back());

// ── State ──────────────────────────────────────────────────────────────
let meta = null;             // { type, id, name, subtitle, image }
let allTracks = [];          // full lookup pool (id -> metadata), used for rank list rendering
let leftPanelTracks = [];    // subset actually rendered in the left tracklist column
let sizeOptions = [];        // [{ label, value }]
let rankSize = 5;
let rankedIds = [];          // ordered array of track ids, length <= rankSize

function addToPool(track) {
    if (!allTracks.some(t => t.id === track.id)) {
        allTracks = [...allTracks, track];
    }
}

function getParams() {
    const p = new URLSearchParams(window.location.search);
    return {
        type: p.get("type"),
        id: p.get("id"),
        size: p.get("size") ? Number(p.get("size")) : null,
        order: p.get("order") ? p.get("order").split(",").filter(Boolean) : [],
    };
}

function syncUrl() {
    const p = new URLSearchParams();
    p.set("type", meta.type);
    p.set("id", meta.id);
    p.set("size", String(rankSize));
    if (rankedIds.length) p.set("order", rankedIds.join(","));
    history.replaceState(null, "", `${window.location.pathname}?${p.toString()}`);
}

// ── Data fetching ──────────────────────────────────────────────────────
async function spotifyFetch(token, url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Spotify fetch failed: ${res.status}`);
    return res.json();
}

async function loadArtist(token, id) {
    const artist = await spotifyFetch(token, `https://api.spotify.com/v1/artists/${id}`);
    const topTracks = await spotifyFetch(token, `https://api.spotify.com/v1/artists/${id}/top-tracks?market=GB`);

    meta = {
        type: "artist",
        id,
        name: artist.name,
        subtitle: "Artist",
        image: artist.images?.[0]?.url || "",
    };

    allTracks = (topTracks.tracks || []).map(t => ({
        id: t.id,
        name: t.name,
        artists: (t.artists || []).map(a => a.name),
        image: t.album?.images?.[0]?.url || meta.image,
    }));

    sizeOptions = [
        { label: "Top 5", value: 5 },
        { label: "Top 10", value: Math.min(10, allTracks.length) || 10 },
    ];
}

async function loadAlbum(token, id) {
    const album = await spotifyFetch(token, `https://api.spotify.com/v1/albums/${id}?market=GB`);

    meta = {
        type: "album",
        id,
        name: album.name,
        subtitle: (album.artists || []).map(a => a.name).join(", "),
        image: album.images?.[0]?.url || "",
    };

    allTracks = (album.tracks?.items || []).map(t => ({
        id: t.id,
        name: t.name,
        artists: (t.artists || []).map(a => a.name),
        image: meta.image,
    }));

    sizeOptions = [
        { label: "Top 5", value: Math.min(5, allTracks.length) || 5 },
        { label: "Whole album", value: allTracks.length },
    ];
}

// ── Rendering ──────────────────────────────────────────────────────────
function renderHead() {
    headEl.innerHTML = `
        ${meta.image ? `<img class="rank-head-img ${meta.type === "artist" ? "round" : ""}" src="${meta.image}" alt="">` : ""}
        <div class="rank-head-meta">
            <div class="rank-head-name-row">
                <h1 class="rank-head-name">${meta.name}</h1>
                <button id="rank-play-btn" class="rank-play-btn" type="button" aria-label="Play">&#9654; Play</button>
            </div>
            <p class="rank-head-sub">${meta.subtitle}</p>
        </div>
    `;

    document.getElementById("rank-play-btn")?.addEventListener("click", togglePlayer);
}

function togglePlayer() {
    const btn = document.getElementById("rank-play-btn");
    const isOpen = playerWrapEl.style.display !== "none";

    if (isOpen) {
        playerWrapEl.style.display = "none";
        playerWrapEl.innerHTML = "";
        if (btn) btn.innerHTML = "&#9654; Play";
        return;
    }

    const embedPath = meta.type === "album" ? `album/${meta.id}` : `artist/${meta.id}`;
    playerWrapEl.innerHTML = `
        <iframe
            src="https://open.spotify.com/embed/${embedPath}?theme=0"
            width="100%"
            height="380"
            frameborder="0"
            allowtransparency="true"
            allow="encrypted-media">
        </iframe>
    `;
    playerWrapEl.style.display = "block";
    if (btn) btn.innerHTML = "&#10005; Close player";
}

function renderFilterToggle() {
    filterEl.innerHTML = "";
    sizeOptions.forEach(opt => {
        const btn = document.createElement("button");
        btn.className = "tab-btn" + (opt.value === rankSize ? " active" : "");
        btn.textContent = opt.label;
        btn.addEventListener("click", () => {
            if (opt.value === rankSize) return;
            rankSize = opt.value;
            if (rankedIds.length > rankSize) rankedIds = rankedIds.slice(0, rankSize);
            renderAll();
            syncUrl();
        });
        filterEl.appendChild(btn);
    });
}

function trackRow(track) {
    const isRanked = rankedIds.includes(track.id);
    const row = document.createElement("div");
    row.className = "track-row" + (isRanked ? " added" : "");
    row.innerHTML = `
        ${track.image ? `<img class="track-row-img" src="${track.image}" alt="">` : `<div class="track-row-img rank-result-placeholder"></div>`}
        <div class="track-row-meta">
            <span class="track-row-name">${track.name}</span>
            <span class="track-row-sub">${(track.artists || []).join(", ")}</span>
        </div>
        ${isRanked
            ? `<span class="track-row-check" aria-hidden="true">&#10003;</span>`
            : `<button class="track-row-add" aria-label="Add to ranking" ${rankedIds.length >= rankSize ? "disabled" : ""}>+</button>`
        }
    `;
    if (!isRanked) {
        row.querySelector(".track-row-add")?.addEventListener("click", () => {
            if (rankedIds.length >= rankSize) return;
            rankedIds.push(track.id);
            renderAll();
            syncUrl();
        });
    }
    return row;
}

function renderTrackList() {
    trackListEl.innerHTML = "";
    // Keep the visible tracklist in sync with the current ranking size —
    // Top 5 shows 5 tracks, Top 10 shows 10, Whole album shows every track.
    leftPanelTracks.slice(0, rankSize).forEach(t => trackListEl.appendChild(trackRow(t)));
}

function rankRow(trackId, index) {
    const track = allTracks.find(t => t.id === trackId);
    const row = document.createElement("div");
    row.className = "rank-row";

    if (!track) {
        row.classList.add("empty");
        row.innerHTML = `<span class="rank-row-num">${index + 1}</span><span class="rank-row-empty-text">Add a track</span>`;
        return row;
    }

    row.innerHTML = `
        <span class="rank-row-num">${index + 1}</span>
        ${track.image ? `<img class="track-row-img" src="${track.image}" alt="">` : ""}
        <div class="track-row-meta">
            <span class="track-row-name">${track.name}</span>
            <span class="track-row-sub">${(track.artists || []).join(", ")}</span>
        </div>
        <div class="rank-row-controls">
            <button class="rank-row-move" data-dir="up" aria-label="Move up" ${index === 0 ? "disabled" : ""}>&#9650;</button>
            <button class="rank-row-move" data-dir="down" aria-label="Move down" ${index === rankedIds.length - 1 ? "disabled" : ""}>&#9660;</button>
            <button class="rank-row-remove" aria-label="Remove from ranking">&#10005;</button>
        </div>
    `;

    row.querySelector('[data-dir="up"]')?.addEventListener("click", () => {
        if (index === 0) return;
        [rankedIds[index - 1], rankedIds[index]] = [rankedIds[index], rankedIds[index - 1]];
        renderAll();
        syncUrl();
    });
    row.querySelector('[data-dir="down"]')?.addEventListener("click", () => {
        if (index === rankedIds.length - 1) return;
        [rankedIds[index + 1], rankedIds[index]] = [rankedIds[index], rankedIds[index + 1]];
        renderAll();
        syncUrl();
    });
    row.querySelector(".rank-row-remove")?.addEventListener("click", () => {
        rankedIds = rankedIds.filter(id => id !== trackId);
        renderAll();
        syncUrl();
    });

    return row;
}

function renderRankList() {
    rankListEl.innerHTML = "";
    for (let i = 0; i < rankSize; i++) {
        rankListEl.appendChild(rankRow(rankedIds[i] ?? null, i));
    }
    rankTitleEl.textContent = `Your ranking (${rankedIds.length}/${rankSize})`;
}

function renderAll() {
    renderFilterToggle();
    renderTrackList();
    renderRankList();
}

// ── Mobile tabs ────────────────────────────────────────────────────────
function initMobileTabs() {
    const tabs = document.querySelectorAll(".rank-mobile-tabs .tab-btn");
    const tracksPanel = document.getElementById("rank-panel-tracks");
    const rankingPanel = document.getElementById("rank-panel-ranking");

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            const which = tab.dataset.panel;
            tracksPanel.classList.toggle("mobile-hidden", which !== "tracks");
            rankingPanel.classList.toggle("mobile-hidden", which !== "ranking");
        });
    });
}

// ── Share ──────────────────────────────────────────────────────────────
function initShare() {
    if (!shareBtn) return;
    shareBtn.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            const original = shareBtn.textContent;
            shareBtn.textContent = "Link copied";
            setTimeout(() => (shareBtn.textContent = original), 1600);
        } catch {
            alert("Couldn't copy the link automatically — you can copy it from the address bar.");
        }
    });
}

// ── Clear rankings ──────────────────────────────────────────────────
function initClearButton() {
    if (!clearRankBtn) return;
    clearRankBtn.addEventListener("click", () => {
        if (!rankedIds.length) return;
        rankedIds = [];
        renderAll();
        syncUrl();
    });
}

// ── Extra catalog search (artists only — deep cuts beyond top tracks) ──
function initTrackSearch() {
    if (meta.type !== "artist" || !trackSearchEl) return;
    trackSearchEl.style.display = "flex";

    const run = () => {
        const q = trackSearchInput.value.trim();
        clearTimeout(suggestDebounce);
        if (q.length >= 2) fetchSearchResults(q);
        else hideSuggestions();
    };

    trackSearchBtn?.addEventListener("click", run);
    trackSearchInput?.addEventListener("keydown", e => {
        if (e.key === "Enter") run();
        if (e.key === "Escape") hideSuggestions();
    });

    trackSearchInput?.addEventListener("input", () => {
        const q = trackSearchInput.value.trim();
        clearTimeout(suggestDebounce);
        if (q.length < 2) {
            hideSuggestions();
            return;
        }
        suggestDebounce = setTimeout(() => fetchSearchResults(q), 300);
    });

    document.addEventListener("click", e => {
        if (!trackSearchEl.contains(e.target)) hideSuggestions();
    });
}

function hideSuggestions() {
    if (trackSearchSuggestions) {
        trackSearchSuggestions.innerHTML = "";
        trackSearchSuggestions.style.display = "none";
    }
}

function addSearchResultToRanking(track, rowEl) {
    if (rankedIds.length >= rankSize || rankedIds.includes(track.id)) return;
    addToPool(track);
    rankedIds.push(track.id);
    renderRankList();
    renderTrackList();
    syncUrl();
    markSearchRowAdded(rowEl);
}

function markSearchRowAdded(rowEl) {
    const btn = rowEl.querySelector(".track-suggestion-add");
    if (btn) {
        btn.textContent = "Added";
        btn.disabled = true;
    }
}

async function fetchSearchResults(query) {
    if (!cachedToken || !trackSearchSuggestions) return;

    try {
        // Search 1: tracks whose title matches, scoped to this artist
        const trackUrl = new URL("https://api.spotify.com/v1/search");
        trackUrl.searchParams.set("q", `track:"${query}" artist:"${meta.name}"`);
        trackUrl.searchParams.set("type", "track");
        trackUrl.searchParams.set("limit", "6");
        trackUrl.searchParams.set("market", "GB");

        // Search 2: albums whose title matches, scoped to this artist —
        // if found, pull that album's full tracklist into the results too
        const albumUrl = new URL("https://api.spotify.com/v1/search");
        albumUrl.searchParams.set("q", `album:"${query}" artist:"${meta.name}"`);
        albumUrl.searchParams.set("type", "album");
        albumUrl.searchParams.set("limit", "2");
        albumUrl.searchParams.set("market", "GB");

        const [trackData, albumData] = await Promise.all([
            spotifyFetch(cachedToken, trackUrl.toString()),
            spotifyFetch(cachedToken, albumUrl.toString()),
        ]);

        const trackResults = (trackData?.tracks?.items || []).map(t => ({
            id: t.id,
            name: t.name,
            artists: (t.artists || []).map(a => a.name),
            image: t.album?.images?.[0]?.url || meta.image,
            sub: (t.artists || []).map(a => a.name).join(", "),
        }));

        const matchedAlbums = albumData?.albums?.items || [];
        let albumTrackResults = [];

        if (matchedAlbums.length) {
            const albumTrackLists = await Promise.all(
                matchedAlbums.map(al =>
                    spotifyFetch(cachedToken, `https://api.spotify.com/v1/albums/${al.id}/tracks?market=GB&limit=50`)
                        .then(data => ({ album: al, tracks: data?.items || [] }))
                        .catch(() => ({ album: al, tracks: [] }))
                )
            );

            albumTrackLists.forEach(({ album, tracks }) => {
                tracks.forEach(t => {
                    albumTrackResults.push({
                        id: t.id,
                        name: t.name,
                        artists: (t.artists || []).map(a => a.name),
                        image: album.images?.[0]?.url || meta.image,
                        sub: `From ${album.name}`,
                    });
                });
            });
        }

        const seen = new Set();
        const combined = [...trackResults, ...albumTrackResults].filter(t => {
            if (seen.has(t.id)) return false;
            seen.add(t.id);
            return true;
        }).slice(0, 12);

        renderSearchResults(combined);
    } catch (err) {
        console.error(err);
        hideSuggestions();
    }
}

function renderSearchResults(results) {
    if (!results.length) {
        trackSearchSuggestions.innerHTML = `<p class="track-suggestion-empty">No matching songs or albums found</p>`;
        trackSearchSuggestions.style.display = "block";
        return;
    }

    trackSearchSuggestions.innerHTML = "";
    results.forEach(track => {
        const isRanked = rankedIds.includes(track.id);
        const isFull = rankedIds.length >= rankSize;
        const item = document.createElement("div");
        item.className = "track-suggestion";
        item.innerHTML = `
            ${track.image ? `<img class="track-suggestion-img" src="${track.image}" alt="">` : ""}
            <div class="track-suggestion-meta">
                <span class="track-suggestion-name">${track.name}</span>
                <span class="track-suggestion-sub">${track.sub || ""}</span>
            </div>
            <button class="track-suggestion-add" ${isRanked || isFull ? "disabled" : ""}>${isRanked ? "Added" : "+"}</button>
        `;
        item.querySelector(".track-suggestion-add")?.addEventListener("click", e => {
            e.stopPropagation();
            addSearchResultToRanking(track, item);
        });
        trackSearchSuggestions.appendChild(item);
    });

    trackSearchSuggestions.style.display = "block";
}

// ── Init ───────────────────────────────────────────────────────────────
async function init() {
    const { type, id, size, order } = getParams();

    if (!type || !id || (type !== "artist" && type !== "album")) {
        loadingEl.innerHTML = `<div class="loading-card"><div class="loading-title">No artist or album selected</div><div class="loading-sub">Go back and search for one to rank.</div></div>`;
        return;
    }

    try {
        const token = await getSpotifyToken();
        cachedToken = token;
        if (type === "artist") await loadArtist(token, id);
        else await loadAlbum(token, id);

        if (!allTracks.length) {
            loadingEl.innerHTML = `<div class="loading-card"><div class="loading-title">No tracks found</div><div class="loading-sub">Try a different artist or album.</div></div>`;
            return;
        }

        leftPanelTracks = allTracks.slice();

        rankSize = size && sizeOptions.some(o => o.value === size) ? size : sizeOptions[0].value;
        rankedIds = order.filter(oid => allTracks.some(t => t.id === oid)).slice(0, rankSize);

        renderHead();
        renderAll();
        initMobileTabs();
        initShare();
        initTrackSearch();
        initClearButton();

        loadingEl.style.display = "none";
        pageEl.style.display = "block";
        syncUrl();
    } catch (err) {
        console.error(err);
        loadingEl.innerHTML = `<div class="loading-card"><div class="loading-title">Something went wrong</div><div class="loading-sub">Please try again later.</div></div>`;
    }
}

init();
