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

if (backBtn) backBtn.addEventListener("click", () => history.back());

// ── State ──────────────────────────────────────────────────────────────
let meta = null;          // { type, id, name, subtitle, image }
let allTracks = [];       // [{ id, name, artists, image }]
let sizeOptions = [];     // [{ label, value }]
let rankSize = 5;
let rankedIds = [];       // ordered array of track ids, length <= rankSize

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
            <h1 class="rank-head-name">${meta.name}</h1>
            <p class="rank-head-sub">${meta.subtitle}</p>
        </div>
    `;
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
            ? `<i class="ti ti-check track-row-check" aria-hidden="true"></i>`
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
    allTracks.forEach(t => trackListEl.appendChild(trackRow(t)));
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
            <button class="rank-row-move" data-dir="up" aria-label="Move up" ${index === 0 ? "disabled" : ""}><i class="ti ti-chevron-up" aria-hidden="true"></i></button>
            <button class="rank-row-move" data-dir="down" aria-label="Move down" ${index === rankedIds.length - 1 ? "disabled" : ""}><i class="ti ti-chevron-down" aria-hidden="true"></i></button>
            <button class="rank-row-remove" aria-label="Remove from ranking"><i class="ti ti-x" aria-hidden="true"></i></button>
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

// ── Init ───────────────────────────────────────────────────────────────
async function init() {
    const { type, id, size, order } = getParams();

    if (!type || !id || (type !== "artist" && type !== "album")) {
        loadingEl.innerHTML = `<div class="loading-card"><div class="loading-title">No artist or album selected</div><div class="loading-sub">Go back and search for one to rank.</div></div>`;
        return;
    }

    try {
        const token = await getSpotifyToken();
        if (type === "artist") await loadArtist(token, id);
        else await loadAlbum(token, id);

        if (!allTracks.length) {
            loadingEl.innerHTML = `<div class="loading-card"><div class="loading-title">No tracks found</div><div class="loading-sub">Try a different artist or album.</div></div>`;
            return;
        }

        rankSize = size && sizeOptions.some(o => o.value === size) ? size : sizeOptions[0].value;
        rankedIds = order.filter(oid => allTracks.some(t => t.id === oid)).slice(0, rankSize);

        renderHead();
        renderAll();
        initMobileTabs();
        initShare();

        loadingEl.style.display = "none";
        pageEl.style.display = "block";
        syncUrl();
    } catch (err) {
        console.error(err);
        loadingEl.innerHTML = `<div class="loading-card"><div class="loading-title">Something went wrong</div><div class="loading-sub">Please try again later.</div></div>`;
    }
}

init();
