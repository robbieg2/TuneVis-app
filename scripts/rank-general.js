// rank-general.js — personal "favourite artists" / "favourite tracks" rankings
import { getSpotifyToken } from "./auth.js";

const LASTFM_API_KEY = "2e23f6b1b4b3345ab5e33a788a072303";
const LASTFM_BASE = "https://ws.audioscrobbler.com/2.0/";
const POOL_CACHE_TTL = 60 * 60 * 1000; // 1 hour

const backBtn = document.getElementById("back-btn");
const shareBtn = document.getElementById("share-btn");
const loadingEl = document.getElementById("rank-page-loading");
const pageEl = document.getElementById("rank-page");
const modeToggleEl = document.getElementById("rank-mode-toggle");
const filterEl = document.getElementById("rank-filter-toggle");
const trackListEl = document.getElementById("track-list");
const trackListTitleEl = document.getElementById("rank-panel-tracks-title");
const rankListEl = document.getElementById("rank-list");
const rankTitleEl = document.getElementById("rank-panel-ranking-title");
const clearRankBtn = document.getElementById("clear-rank-btn");
const trackSearchInput = document.getElementById("track-search-input");
const trackSearchBtn = document.getElementById("track-search-btn");
const trackSearchSuggestions = document.getElementById("track-search-suggestions");

let cachedToken = null;
let suggestDebounce = null;
let searchRequestId = 0;

if (backBtn) backBtn.addEventListener("click", () => history.back());

// ── State ──────────────────────────────────────────────────────────────
let mode = "artist";       // "artist" | "track"
let pool = [];              // lookup: id -> { id, name, subtitle, image }
let leftPanelItems = [];    // popular items shown on the left
let rankSize = 5;
let rankedIds = [];

const SIZE_OPTIONS = [
    { label: "Top 5", value: 5 },
    { label: "Top 10", value: 10 },
];

function addToPool(item) {
    if (!pool.some(p => p.id === item.id)) pool = [...pool, item];
}

// ── URL state ─────────────────────────────────────────────────────────
function getParams() {
    const p = new URLSearchParams(window.location.search);
    const m = p.get("mode");
    return {
        mode: m === "artist" || m === "track" ? m : null,
        size: p.get("size") ? Number(p.get("size")) : null,
        order: p.get("order") ? p.get("order").split(",").filter(Boolean) : [],
    };
}

function syncUrl() {
    const p = new URLSearchParams();
    p.set("mode", mode);
    p.set("size", String(rankSize));
    if (rankedIds.length) p.set("order", rankedIds.join(","));
    history.replaceState(null, "", `${window.location.pathname}?${p.toString()}`);
}

// ── Data fetching ──────────────────────────────────────────────────────
async function spotifyFetch(url) {
    let res = await fetch(url, { headers: { Authorization: `Bearer ${cachedToken}` } });
    if (res.status === 401) {
        cachedToken = await getSpotifyToken(true);
        res = await fetch(url, { headers: { Authorization: `Bearer ${cachedToken}` } });
    }
    if (!res.ok) throw new Error(`Spotify fetch failed: ${res.status}`);
    return res.json();
}

async function lastfmChart(method, limit) {
    const url = new URL(LASTFM_BASE);
    url.searchParams.set("method", method);
    url.searchParams.set("api_key", LASTFM_API_KEY);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("format", "json");
    const res = await fetch(url.toString());
    return res.json();
}

async function resolveConcurrently(items, resolver, concurrency = 4) {
    const results = [];
    let idx = 0;
    async function worker() {
        while (idx < items.length) {
            const item = items[idx++];
            try {
                const resolved = await resolver(item);
                if (resolved) results.push(resolved);
            } catch {}
        }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    return results;
}

async function fetchPopularArtists() {
    const data = await lastfmChart("chart.getTopArtists", 15);
    const artists = data?.artists?.artist || [];
    return resolveConcurrently(artists, async a => {
        const url = new URL("https://api.spotify.com/v1/search");
        url.searchParams.set("q", `artist:"${a.name}"`);
        url.searchParams.set("type", "artist");
        url.searchParams.set("limit", "1");
        const data = await spotifyFetch(url.toString());
        const item = data?.artists?.items?.[0];
        if (!item) return null;
        return { id: item.id, name: item.name, subtitle: "Artist", image: item.images?.[0]?.url || "" };
    });
}

async function fetchPopularTracks() {
    const data = await lastfmChart("chart.getTopTracks", 15);
    const tracks = data?.tracks?.track || [];
    return resolveConcurrently(tracks, async t => {
        const url = new URL("https://api.spotify.com/v1/search");
        url.searchParams.set("q", `track:"${t.name}" artist:"${t.artist?.name || ""}"`);
        url.searchParams.set("type", "track");
        url.searchParams.set("limit", "1");
        const data = await spotifyFetch(url.toString());
        const item = data?.tracks?.items?.[0];
        if (!item) return null;
        return {
            id: item.id,
            name: item.name,
            subtitle: (item.artists || []).map(a => a.name).join(", "),
            image: item.album?.images?.[0]?.url || "",
        };
    });
}

async function loadPopularPool(forMode) {
    const cacheKey = `tunevis_general_${forMode}_cache`;
    try {
        const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
        if (cached && Date.now() - cached.cachedAt < POOL_CACHE_TTL && Array.isArray(cached.items)) {
            return cached.items;
        }
    } catch {}

    const items = forMode === "artist" ? await fetchPopularArtists() : await fetchPopularTracks();

    try {
        localStorage.setItem(cacheKey, JSON.stringify({ items, cachedAt: Date.now() }));
    } catch {}

    return items;
}

// Guarantees correct display for shared links regardless of whether an id
// happens to still be in the current popular pool.
async function fetchMetadataForIds(ids, forMode) {
    if (!ids.length) return [];
    const chunks = [];
    for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));

    const results = [];
    for (const chunk of chunks) {
        try {
            if (forMode === "artist") {
                const data = await spotifyFetch(`https://api.spotify.com/v1/artists?ids=${chunk.join(",")}`);
                (data?.artists || []).filter(Boolean).forEach(a => {
                    results.push({ id: a.id, name: a.name, subtitle: "Artist", image: a.images?.[0]?.url || "" });
                });
            } else {
                const data = await spotifyFetch(`https://api.spotify.com/v1/tracks?ids=${chunk.join(",")}`);
                (data?.tracks || []).filter(Boolean).forEach(t => {
                    results.push({
                        id: t.id,
                        name: t.name,
                        subtitle: (t.artists || []).map(a => a.name).join(", "),
                        image: t.album?.images?.[0]?.url || "",
                    });
                });
            }
        } catch {}
    }
    return results;
}

// ── Rendering ──────────────────────────────────────────────────────────
function renderFilterToggle() {
    filterEl.innerHTML = "";
    SIZE_OPTIONS.forEach(opt => {
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

function itemRow(item) {
    const isRanked = rankedIds.includes(item.id);
    const row = document.createElement("div");
    row.className = "track-row" + (isRanked ? " added" : "");
    row.innerHTML = `
        ${item.image ? `<img class="track-row-img ${mode === "artist" ? "round" : ""}" src="${item.image}" alt="">` : `<div class="track-row-img rank-result-placeholder ${mode === "artist" ? "round" : ""}"></div>`}
        <div class="track-row-meta">
            <span class="track-row-name">${item.name}</span>
            <span class="track-row-sub">${item.subtitle || ""}</span>
        </div>
        ${isRanked
            ? `<span class="track-row-check" aria-hidden="true">&#10003;</span>`
            : `<button class="track-row-add" aria-label="Add to ranking" ${rankedIds.length >= rankSize ? "disabled" : ""}>+</button>`
        }
    `;
    if (!isRanked) {
        row.querySelector(".track-row-add")?.addEventListener("click", () => {
            if (rankedIds.length >= rankSize) return;
            rankedIds.push(item.id);
            renderAll();
            syncUrl();
        });
    }
    return row;
}

function renderLeftList() {
    trackListEl.innerHTML = "";
    leftPanelItems.forEach(item => trackListEl.appendChild(itemRow(item)));
    const visibleRows = Math.min(rankSize, 10);
    trackListEl.style.maxHeight = `${24 + visibleRows * 48}px`;
}

function rankRow(itemId, index) {
    const item = pool.find(p => p.id === itemId);
    const row = document.createElement("div");
    row.className = "rank-row";

    if (!item) {
        row.classList.add("empty");
        row.innerHTML = `<span class="rank-row-num">${index + 1}</span><span class="rank-row-empty-text">Add ${mode === "artist" ? "an artist" : "a track"}</span>`;
        return row;
    }

    row.innerHTML = `
        <span class="rank-row-num">${index + 1}</span>
        ${item.image ? `<img class="track-row-img ${mode === "artist" ? "round" : ""}" src="${item.image}" alt="">` : ""}
        <div class="track-row-meta">
            <span class="track-row-name">${item.name}</span>
            <span class="track-row-sub">${item.subtitle || ""}</span>
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
        rankedIds = rankedIds.filter(id => id !== itemId);
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
    renderLeftList();
    renderRankList();
}

// ── Mode toggle ────────────────────────────────────────────────────────
async function switchMode(newMode) {
    if (newMode === mode) return;
    mode = newMode;
    rankedIds = [];
    pool = [];
    hideSuggestions();
    trackSearchInput.value = "";

    document.querySelectorAll("#rank-mode-toggle .tab-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.mode === mode);
    });

    trackListTitleEl.textContent = mode === "artist" ? "Popular artists" : "Popular tracks";
    trackSearchInput.placeholder = mode === "artist" ? "Search for an artist..." : "Search for a track...";

    trackListEl.innerHTML = `<p class="tab-loading">Loading…</p>`;
    leftPanelItems = await loadPopularPool(mode);
    pool = leftPanelItems.slice();

    renderAll();
    syncUrl();
}

function initModeToggle() {
    modeToggleEl.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => switchMode(btn.dataset.mode));
    });
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

// ── Clear rankings ────────────────────────────────────────────────────
function initClearButton() {
    if (!clearRankBtn) return;
    clearRankBtn.addEventListener("click", () => {
        if (!rankedIds.length) return;
        rankedIds = [];
        renderAll();
        syncUrl();
    });
}

// ── Search ────────────────────────────────────────────────────────────
function hideSuggestions() {
    if (trackSearchSuggestions) {
        trackSearchSuggestions.innerHTML = "";
        trackSearchSuggestions.style.display = "none";
    }
}

function addSearchResultToRanking(item, rowEl) {
    if (rankedIds.length >= rankSize || rankedIds.includes(item.id)) return;
    addToPool(item);
    rankedIds.push(item.id);
    renderRankList();
    renderLeftList();
    syncUrl();
    const btn = rowEl.querySelector(".track-suggestion-add");
    if (btn) {
        btn.textContent = "Added";
        btn.disabled = true;
    }
}

async function fetchSearchResults(query) {
    if (!cachedToken || !trackSearchSuggestions) return;
    const requestId = ++searchRequestId;

    try {
        const url = new URL("https://api.spotify.com/v1/search");
        url.searchParams.set("q", query);
        url.searchParams.set("type", mode === "artist" ? "artist" : "track");
        url.searchParams.set("limit", "8");

        const data = await spotifyFetch(url.toString());

        const results = mode === "artist"
            ? (data?.artists?.items || []).map(a => ({ id: a.id, name: a.name, subtitle: "Artist", image: a.images?.[0]?.url || "" }))
            : (data?.tracks?.items || []).map(t => ({
                id: t.id,
                name: t.name,
                subtitle: (t.artists || []).map(a => a.name).join(", "),
                image: t.album?.images?.[0]?.url || "",
            }));

        if (requestId !== searchRequestId) return;
        renderSearchResults(results);
    } catch (err) {
        if (requestId !== searchRequestId) return;
        console.error(err);
        hideSuggestions();
    }
}

function renderSearchResults(results) {
    if (!results.length) {
        trackSearchSuggestions.innerHTML = `<p class="track-suggestion-empty">No matches found</p>`;
        trackSearchSuggestions.style.display = "block";
        return;
    }

    trackSearchSuggestions.innerHTML = "";
    results.forEach(item => {
        const isRanked = rankedIds.includes(item.id);
        const isFull = rankedIds.length >= rankSize;
        const row = document.createElement("div");
        row.className = "track-suggestion";
        row.innerHTML = `
            ${item.image ? `<img class="track-suggestion-img" src="${item.image}" alt="">` : ""}
            <div class="track-suggestion-meta">
                <span class="track-suggestion-name">${item.name}</span>
                <span class="track-suggestion-sub">${item.subtitle || ""}</span>
            </div>
            <button class="track-suggestion-add" ${isRanked || isFull ? "disabled" : ""}>${isRanked ? "Added" : "+"}</button>
        `;
        row.querySelector(".track-suggestion-add")?.addEventListener("click", e => {
            e.stopPropagation();
            addSearchResultToRanking(item, row);
        });
        trackSearchSuggestions.appendChild(row);
    });

    trackSearchSuggestions.style.display = "block";
}

function initTrackSearch() {
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
        const wrap = document.getElementById("track-search");
        if (wrap && !wrap.contains(e.target)) hideSuggestions();
    });
}

// ── Init ───────────────────────────────────────────────────────────────
async function init() {
    try {
        cachedToken = await getSpotifyToken();

        const params = getParams();
        mode = params.mode || "artist";
        rankSize = params.size && SIZE_OPTIONS.some(o => o.value === params.size) ? params.size : 5;

        document.querySelectorAll("#rank-mode-toggle .tab-btn").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.mode === mode);
        });
        trackListTitleEl.textContent = mode === "artist" ? "Popular artists" : "Popular tracks";
        trackSearchInput.placeholder = mode === "artist" ? "Search for an artist..." : "Search for a track...";

        leftPanelItems = await loadPopularPool(mode);
        pool = leftPanelItems.slice();

        if (params.order.length) {
            const shared = await fetchMetadataForIds(params.order, mode);
            shared.forEach(addToPool);
            const validIds = new Set(pool.map(p => p.id));
            rankedIds = params.order.filter(id => validIds.has(id)).slice(0, rankSize);
        }

        renderAll();
        initModeToggle();
        initMobileTabs();
        initShare();
        initClearButton();
        initTrackSearch();

        loadingEl.style.display = "none";
        pageEl.style.display = "block";
        syncUrl();
    } catch (err) {
        console.error(err);
        loadingEl.innerHTML = `<div class="loading-card"><div class="loading-title">Something went wrong</div><div class="loading-sub">Please try again later.</div></div>`;
    }
}

init();
