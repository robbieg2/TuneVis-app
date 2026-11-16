// rank.js — artist / album ranking workspace
//
// An album page ranks the album's tracks (and gives it a star rating). An artist page
// ranks either the artist's top tracks or their albums ("Top tracks / Albums" toggle);
// each list keeps its own ranking, name and saved copy. A saved ranking opens as a
// finished, read-only list (rank-view.js); Edit switches to the two-column workspace.
import { getSpotifyToken, esc } from "./auth.js";
import { buildRankingText, buildRankingImage, downloadCanvas, copyText } from "./rank-share.js";
import { initSaveButton, KIND_LABELS } from "./saved-rankings.js";
import { createStarRating, parseRating, starsText, starsHtml, formatRating } from "./star-rating.js";
import { setViewMode, renderRankView } from "./rank-view.js";

const backBtn = document.getElementById("back-btn");
const listNameInput = document.getElementById("list-name-input");
const exportBtn = document.getElementById("export-btn");
const saveBtn = document.getElementById("save-rank-btn");
const doneBtn = document.getElementById("rank-done-btn");
const editBtn = document.getElementById("rank-edit-btn");
const viewExportBtn = document.getElementById("rank-view-export-btn");
const listToggleEl = document.getElementById("rank-list-toggle");
const loadingEl = document.getElementById("rank-page-loading");
const pageEl = document.getElementById("rank-page");
const headEl = document.getElementById("rank-head");
const filterEl = document.getElementById("rank-filter-toggle");
const trackListEl = document.getElementById("track-list");
const trackListTitleEl = document.getElementById("rank-panel-tracks-title");
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
let list = "tracks";         // artist pages: "tracks" (top tracks) or "albums"
let allTracks = [];          // lookup pool for the current list (tracks or albums)
let leftPanelTracks = [];    // what the left column shows (albums mode: filtered by search)
let sizeOptions = [];        // [{ label, value }]
let rankSize = 5;
let rankedIds = [];          // ordered ids, length <= rankSize
let listName = "";           // user-editable title for this ranking, used in exports
let savedId = null;          // the saved ranking (account) this page is editing, if any
let saveCtl = { refresh() {}, reset() {}, isDirty: () => false, save: async () => true };
let rating = null;           // album only: overall star rating, 0.5–5 in half steps
let viewing = false;         // showing a saved ranking as a finished list

// Artist pages keep each list's ranking separately, so switching between
// "Top tracks" and "Albums" never loses either one.
const listState = { tracks: null, albums: null };
let albumPool = null;        // the artist's albums, loaded the first time Albums is opened

const isAlbumsList = () => meta?.type === "artist" && list === "albums";
const itemWord = () => (isAlbumsList() ? "album or EP" : "track");
const kind = () => (meta.type === "album" ? "album" : isAlbumsList() ? "artist_albums" : "artist");

function addToPool(item) {
    if (!allTracks.some(t => t.id === item.id)) {
        allTracks = [...allTracks, item];
    }
}

function getParams() {
    const p = new URLSearchParams(window.location.search);
    return {
        type: p.get("type"),
        id: p.get("id"),
        list: p.get("list") === "albums" ? "albums" : "tracks",
        size: p.get("size") ? Number(p.get("size")) : null,
        order: p.get("order") ? p.get("order").split(",").filter(Boolean) : [],
        name: p.get("name") || null,
        saved: p.get("saved") || null,
        rating: parseRating(p.get("rating")),
        edit: p.get("edit") === "1",
    };
}

function rankingParams() {
    const p = new URLSearchParams();
    p.set("type", meta.type);
    p.set("id", meta.id);
    if (isAlbumsList()) p.set("list", "albums");
    p.set("size", String(rankSize));
    if (rankedIds.length) p.set("order", rankedIds.join(","));
    if (listName) p.set("name", listName);
    if (meta.type === "album" && rating) p.set("rating", String(rating));
    if (savedId) p.set("saved", savedId);
    // A saved ranking opens as the finished list unless the URL says it's being edited.
    if (savedId && !viewing) p.set("edit", "1");
    return p;
}

function syncUrl() {
    history.replaceState(null, "", `${window.location.pathname}?${rankingParams().toString()}`);
    saveCtl.refresh();
}

// ── Saving to an account ───────────────────────────────────────────────
function itemSubtitle(t) {
    return (t.artists || []).join(", ");
}

function getSaveRecord() {
    return {
        kind: kind(),
        source_id: meta.id,
        source_name: meta.name,
        genre: null,
        title: (listName.trim() || defaultListName()).slice(0, 120),
        size: rankSize,
        item_ids: rankedIds.slice(),
        items: rankedIds
            .map(id => allTracks.find(t => t.id === id))
            .filter(Boolean)
            .map(t => ({ id: t.id, name: t.name, subtitle: itemSubtitle(t), image: t.image || "" })),
        image: meta.image || null,
        // Only album rankings have a rating column value.
        ...(meta.type === "album" ? { rating } : {}),
    };
}

function initSave() {
    saveCtl = initSaveButton({
        button: saveBtn,
        getRecord: getSaveRecord,
        getSavedId: () => savedId,
        setSavedId: id => { savedId = id; refreshDoneButton(); syncUrl(); },
        emptyMessage: () => meta.type === "album"
            ? "Give the album a star rating or add at least one track before saving."
            : `Add at least one ${itemWord()} to your ranking before saving.`,
    });
}

// "Done" finishes editing a saved ranking: saves any changes, then shows the list.
function refreshDoneButton() {
    if (doneBtn) doneBtn.hidden = !savedId || saveBtn?.hidden;
}

doneBtn?.addEventListener("click", async () => {
    if (saveCtl.isDirty()) {
        doneBtn.disabled = true;
        const ok = await saveCtl.save();
        doneBtn.disabled = false;
        if (!ok) return;
    }
    enterView();
});

// Tracks added from the catalog search aren't in the top tracks / tracklist, so a
// ranking reopened from a link or a saved ranking looks those up by id.
async function addMissingTracks(token, ids) {
    const missing = ids.filter(id => !allTracks.some(t => t.id === id));
    for (let i = 0; i < missing.length; i += 50) {
        try {
            const data = await spotifyFetch(token, `https://api.spotify.com/v1/tracks?ids=${missing.slice(i, i + 50).join(",")}`);
            (data?.tracks || []).filter(Boolean).forEach(t => addToPool({
                id: t.id,
                name: t.name,
                artists: (t.artists || []).map(a => a.name),
                image: t.album?.images?.[0]?.url || meta.image,
            }));
        } catch {}
    }
}

// Albums mode: a saved album that the de-duplicated list doesn't include (e.g. a
// deluxe edition picked earlier) is looked up by id.
async function addMissingAlbums(token, ids) {
    const missing = ids.filter(id => !allTracks.some(t => t.id === id));
    for (let i = 0; i < missing.length; i += 20) {
        try {
            const data = await spotifyFetch(token, `https://api.spotify.com/v1/albums?ids=${missing.slice(i, i + 20).join(",")}&market=GB`);
            (data?.albums || []).filter(Boolean).forEach(al => addToPool(albumItem(al)));
        } catch {}
    }
}

function defaultListName() {
    if (meta.type === "album") return `${meta.name} Ranking`;
    return isAlbumsList() ? `${meta.name} Albums Ranking` : `${meta.name} Top Tracks`;
}

function initListName() {
    if (!listNameInput) return;
    listNameInput.value = listName;
    listNameInput.addEventListener("input", () => {
        listName = listNameInput.value;
        syncUrl();
    });
    listNameInput.addEventListener("blur", () => {
        if (!listNameInput.value.trim()) {
            listName = defaultListName();
            listNameInput.value = listName;
            syncUrl();
        }
    });
}

// ── Data fetching ──────────────────────────────────────────────────────
async function spotifyFetch(token, url) {
    let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    // A cached token can go stale on a long-open tab — Spotify Client
    // Credentials tokens last ~1 hour. Self-heal once before giving up.
    if (res.status === 401) {
        cachedToken = await getSpotifyToken(true);
        res = await fetch(url, { headers: { Authorization: `Bearer ${cachedToken}` } });
    }

    if (!res.ok) throw new Error(`Spotify fetch failed: ${res.status}`);
    return res.json();
}

// Top 5 / Top 10, capped at how many there are (one option if they'd be the same).
const trackSizeOptions = () => {
    const five = Math.min(5, allTracks.length) || 5;
    const ten = Math.min(10, allTracks.length) || 10;
    return ten === five ? [{ label: `Top ${five}`, value: five }] : [
        { label: "Top 5", value: five },
        { label: "Top 10", value: ten },
    ];
};

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

// Spotify has no "EP" type: EPs are filed as singles. A "single" with 4 or more
// tracks is treated as an EP; shorter ones are real singles and are left out.
const EP_MIN_TRACKS = 4;
const releaseType = al => (al.album_type === "single" || al.album_group === "single" ? "EP" : "Album");

function albumItem(al) {
    const year = (al.release_date || "").slice(0, 4);
    const type = releaseType(al);
    return {
        id: al.id,
        name: al.name,
        artists: [year ? `${year} · ${type}` : type],   // shown as the row's subtitle
        image: al.images?.[0]?.url || meta.image,
        releaseDate: al.release_date || "",
    };
}

// Words that mark another edition of the same record. Deliberately not "live"
// (a live album is its own record, e.g. "W.L. (Live from Stirling Castle)") or
// "version" (re-recordings like "(Taylor's Version)" are separate albums).
const EDITION_WORDS = "deluxe|edition|remaster|remastered|expanded|anniversary|bonus|international";

// Bundles that aren't really albums or EPs: remix packs, karaoke and instrumental
// versions, sped-up / slowed edits, music-video audio.
const NOT_A_RECORD = /\b(remix|remixes|mixes|karaoke|instrumentals?|sped up|slowed|music video)\b/i;

// "W.L. (Deluxe)", "Millennials (Deluxe Edition)", "Album - 2011 Remaster" all share
// the key of the standard edition ("w.l.", "millennials", "album").
function albumKey(name) {
    return String(name).toLowerCase()
        .replace(new RegExp(`\\s*[([][^)\\]]*\\b(${EDITION_WORDS})\\b[^)\\]]*[)\\]]`, "g"), "")
        .replace(new RegExp(`\\s+-\\s+[^-]*\\b(${EDITION_WORDS})\\b.*$`), "")
        .replace(/\s+/g, " ")
        .trim();
}

// Of several editions of one record, show the standard one if Spotify has it,
// otherwise the earliest (e.g. only "W.L. (Deluxe)" exists, so that's shown).
function pickEdition(editions) {
    const standard = editions.filter(al => albumKey(al.name) === al.name.toLowerCase().replace(/\s+/g, " ").trim());
    const pool = standard.length ? standard : editions;
    return pool.slice().sort((a, b) => String(a.release_date).localeCompare(String(b.release_date)))[0];
}

// The artist's albums and EPs (no short singles, compilations or appearances on
// other artists' records), one entry per record, newest first.
async function loadArtistAlbums(token) {
    let url = `https://api.spotify.com/v1/artists/${meta.id}/albums?include_groups=album,single&market=GB&limit=50`;
    const raw = [];
    for (let page = 0; url && page < 6; page++) {
        const data = await spotifyFetch(token, url);
        raw.push(...(data?.items || []));
        url = data?.next || null;
    }
    const records = raw.filter(al =>
        !NOT_A_RECORD.test(al.name) &&
        (releaseType(al) === "Album" || (al.total_tracks || 0) >= EP_MIN_TRACKS));

    const groups = new Map();
    for (const al of records) {
        const key = `${releaseType(al)}:${albumKey(al.name)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(al);
    }
    return [...groups.values()]
        .map(pickEdition)
        .map(albumItem)
        .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
}

// ── Rendering ──────────────────────────────────────────────────────────
// The browser tab title names what's being ranked, e.g. "Abbey Road Album Ranking".
function updateTitle() {
    const what = meta.type === "album" ? "Album" : isAlbumsList() ? "Albums" : "Tracks";
    document.title = `${meta.name} ${what} Ranking — TuneVis`;
}

function renderHead() {
    updateTitle();
    headEl.innerHTML = `
        ${meta.image ? `<img class="rank-head-img ${meta.type === "artist" ? "round" : ""}" src="${esc(meta.image)}" alt="">` : ""}
        <div class="rank-head-meta">
            <div class="rank-head-name-row">
                <h1 class="rank-head-name">${esc(meta.name)}</h1>
                <button id="rank-play-btn" class="rank-play-btn" type="button" aria-label="Play">&#9654; Play</button>
            </div>
            <p class="rank-head-sub">${esc(meta.subtitle)}</p>
        </div>
    `;

    document.getElementById("rank-play-btn")?.addEventListener("click", togglePlayer);
    const metaBox = headEl.querySelector(".rank-head-meta");

    if (meta.type !== "album") return;
    if (viewing) {
        // The finished list shows the rating; it's changed in edit mode.
        if (rating) {
            const el = document.createElement("div");
            el.className = "rank-head-rating rank-head-rating-static";
            el.innerHTML = `${starsHtml(rating, { size: 22 })}<span>${formatRating(rating)} / 5</span>`;
            metaBox.appendChild(el);
        }
        return;
    }
    // Albums get an overall star rating alongside the track order.
    const { el } = createStarRating({
        value: rating,
        label: `Your rating for ${meta.name}`,
        onChange: value => { rating = value; syncUrl(); },
    });
    el.classList.add("rank-head-rating");
    metaBox.appendChild(el);
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
            src="https://open.spotify.com/embed/${esc(embedPath)}?theme=0"
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
        ${track.image ? `<img class="track-row-img" src="${esc(track.image)}" alt="">` : `<div class="track-row-img rank-result-placeholder"></div>`}
        <div class="track-row-meta">
            <span class="track-row-name">${esc(track.name)}</span>
            <span class="track-row-sub">${esc(itemSubtitle(track))}</span>
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
    if (!leftPanelTracks.length && isAlbumsList()) {
        trackListEl.innerHTML = `<p class="track-suggestion-empty">${trackSearchInput?.value.trim() ? "No albums or EPs match that search." : "No albums or EPs found for this artist."}</p>`;
    }
    leftPanelTracks.forEach(t => trackListEl.appendChild(trackRow(t)));
    updateTrackListHeight();
}

function updateTrackListHeight() {
    // Grow how much of the tracklist is visible before scrolling as the
    // ranking size increases — the list itself always shows every track.
    const visibleRows = Math.min(rankSize, 10);
    trackListEl.style.maxHeight = `${24 + visibleRows * 48}px`;
}

function rankRow(trackId, index) {
    const track = allTracks.find(t => t.id === trackId);
    const row = document.createElement("div");
    row.className = "rank-row";

    if (!track) {
        row.classList.add("empty");
        row.innerHTML = `<span class="rank-row-num">${index + 1}</span><span class="rank-row-empty-text">Add ${isAlbumsList() ? "an album or EP" : "a track"}</span>`;
        return row;
    }

    row.innerHTML = `
        <span class="rank-row-num">${index + 1}</span>
        ${track.image ? `<img class="track-row-img" src="${esc(track.image)}" alt="">` : ""}
        <div class="track-row-meta">
            <span class="track-row-name">${esc(track.name)}</span>
            <span class="track-row-sub">${esc(itemSubtitle(track))}</span>
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
    // Phones show one column at a time; the tab carries the count so progress is
    // visible from the tracklist too.
    const mobileTab = document.querySelector('.rank-mobile-tabs .tab-btn[data-panel="ranking"]');
    if (mobileTab) mobileTab.textContent = rankTitleEl.textContent;
}

function renderAll() {
    renderFilterToggle();
    renderTrackList();
    renderRankList();
}

// Labels that depend on whether the artist page is ranking tracks or albums.
function applyListLabels() {
    const albums = isAlbumsList();
    updateTitle();
    if (trackListTitleEl) trackListTitleEl.textContent = albums ? "Albums & EPs" : "Tracklist";
    const mobileTab = document.querySelector('.rank-mobile-tabs .tab-btn[data-panel="tracks"]');
    if (mobileTab) mobileTab.textContent = albums ? "Albums & EPs" : "Tracklist";
    if (trackSearchInput) {
        trackSearchInput.placeholder = albums ? "Filter this artist's albums and EPs..." : "Search songs or albums by this artist...";
    }
    if (trackSearchBtn) trackSearchBtn.hidden = albums;   // albums filter as you type
    listToggleEl?.querySelectorAll("[data-list]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.list === list);
        btn.setAttribute("aria-pressed", String(btn.dataset.list === list));
    });
}

// ── Finished-list view and edit mode ──────────────────────────────────
function viewItems() {
    const round = false;
    return rankedIds
        .map(id => allTracks.find(t => t.id === id))
        .filter(Boolean)
        .map(t => ({ name: t.name, subtitle: itemSubtitle(t), image: t.image, round }));
}

function renderView() {
    const items = viewItems();
    const label = KIND_LABELS[kind()] || "Ranking";
    const noun = isAlbumsList() ? "albums & EPs" : "tracks";
    const count = meta.type === "album"
        ? `${items.length} of ${allTracks.length} tracks ranked`
        : items.length >= rankSize ? `Top ${rankSize} ${noun}` : `${items.length} of top ${rankSize} ${noun} ranked`;
    renderRankView({
        title: listName || defaultListName(),
        meta: `${label} · ${count}`,
        items,
        emptyText: meta.type === "album" ? "No tracks ranked yet." : `No ${isAlbumsList() ? "albums or EPs" : "tracks"} ranked yet.`,
    });
}

function enterView() {
    viewing = true;
    hideSuggestions();
    renderHead();
    renderView();
    setViewMode(true);
    syncUrl();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function enterEdit() {
    viewing = false;
    renderHead();
    setViewMode(false);
    if (listToggleEl) listToggleEl.hidden = meta.type !== "artist";
    applyListLabels();
    refreshDoneButton();
    renderAll();
    syncUrl();
}

editBtn?.addEventListener("click", enterEdit);
viewExportBtn?.addEventListener("click", openExportModal);

// ── Top tracks / Albums (artist pages) ───────────────────────────────
function saveListState() {
    listState[list] = {
        allTracks, leftPanelTracks, sizeOptions, rankSize,
        rankedIds: rankedIds.slice(), listName, savedId,
    };
}

async function switchList(next, { restore = null } = {}) {
    if (meta.type !== "artist" || next === list) return;
    saveListState();
    list = next;
    if (trackSearchInput) trackSearchInput.value = "";
    hideSuggestions();
    applyListLabels();

    const saved = listState[list];
    if (saved) {
        ({ allTracks, leftPanelTracks, sizeOptions, rankSize, listName, savedId } = saved);
        rankedIds = saved.rankedIds.slice();
    } else {
        trackListEl.innerHTML = `<p class="tab-loading">Loading albums and EPs…</p>`;
        if (!albumPool) {
            try {
                albumPool = await loadArtistAlbums(cachedToken);
            } catch (err) {
                console.error(err);
                albumPool = [];
            }
        }
        if (list !== next) return;   // switched back while loading
        allTracks = albumPool.slice();
        leftPanelTracks = allTracks.slice();
        sizeOptions = trackSizeOptions();
        rankSize = restore?.size && sizeOptions.some(o => o.value === restore.size) ? restore.size : sizeOptions[0].value;
        rankedIds = [];
        if (restore?.order?.length) {
            await addMissingAlbums(cachedToken, restore.order.slice(0, rankSize));
            rankedIds = restore.order.filter(id => allTracks.some(t => t.id === id)).slice(0, rankSize);
        }
        listName = restore?.name || defaultListName();
        savedId = restore?.saved || null;
    }
    if (listNameInput) listNameInput.value = listName;
    saveCtl.reset();
    refreshDoneButton();
    renderAll();
    syncUrl();
}

listToggleEl?.addEventListener("click", e => {
    const btn = e.target.closest("[data-list]");
    if (btn) switchList(btn.dataset.list);
});

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

// ── Export ────────────────────────────────────────────────────────────
function getRankedItemsForExport() {
    return rankedIds
        .map(id => allTracks.find(t => t.id === id))
        .filter(Boolean)
        .map(t => ({ name: t.name, subtitle: itemSubtitle(t), image: t.image }));
}

function initExport() {
    if (!exportBtn) return;
    exportBtn.addEventListener("click", openExportModal);
}

async function openExportModal() {
    const items = getRankedItemsForExport();
    if (!items.length) {
        alert(`Add at least one ${itemWord()} to your ranking before exporting.`);
        return;
    }

    document.getElementById("export-modal")?.remove();

    const modal = document.createElement("div");
    modal.id = "export-modal";
    modal.className = "site-info-modal open";
    modal.innerHTML = `
        <div class="site-info-card export-modal-card">
            <button class="site-info-close" aria-label="Close">X</button>
            <h2>Export your ranking</h2>
            <div class="export-preview-wrap" id="export-preview-wrap">
                <p class="tab-loading">Rendering preview…</p>
            </div>
            <div class="export-actions">
                <button id="export-download-btn" type="button">Download image</button>
                <button id="export-copy-btn" type="button">Copy as text</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector(".site-info-close").addEventListener("click", () => modal.remove());
    modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });

    const ratingNote = meta.type === "album" && rating ? `  ·  ${starsText(rating)} ${formatRating(rating)}/5` : "";
    const subtitle = meta.type === "album"
        ? `${meta.subtitle}${ratingNote}`
        : isAlbumsList() ? `${meta.name} · Albums & EPs` : "Top Tracks";
    const exportData = { title: listName || defaultListName(), subtitle, items };

    document.getElementById("export-copy-btn")?.addEventListener("click", async () => {
        try {
            await copyText(buildRankingText(exportData));
            const btn = document.getElementById("export-copy-btn");
            const original = btn.textContent;
            btn.textContent = "Copied";
            setTimeout(() => (btn.textContent = original), 1600);
        } catch {
            alert("Couldn't copy automatically — please copy the text manually.");
        }
    });

    try {
        const canvas = await buildRankingImage(exportData);
        const previewWrap = document.getElementById("export-preview-wrap");
        if (previewWrap) {
            previewWrap.innerHTML = "";
            canvas.className = "export-preview-canvas";
            previewWrap.appendChild(canvas);
        }
        document.getElementById("export-download-btn")?.addEventListener("click", () => {
            downloadCanvas(canvas, `${(listName || defaultListName()).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`);
        });
    } catch (err) {
        console.error(err);
        const previewWrap = document.getElementById("export-preview-wrap");
        if (previewWrap) previewWrap.innerHTML = `<p class="muted">Couldn't render an image preview — you can still copy the ranking as text.</p>`;
        const downloadBtn = document.getElementById("export-download-btn");
        if (downloadBtn) downloadBtn.disabled = true;
    }
}

// ── Search (artist pages) ─────────────────────────────────────────────
// Top tracks: a Spotify catalog search for deep cuts beyond the top tracks.
// Albums: filters the artist's album list as you type.
function filterAlbums(q) {
    const needle = q.trim().toLowerCase();
    leftPanelTracks = needle ? allTracks.filter(a => a.name.toLowerCase().includes(needle)) : allTracks.slice();
    renderTrackList();
}

function initTrackSearch() {
    if (meta.type !== "artist" || !trackSearchEl) return;
    trackSearchEl.style.display = "flex";

    const run = () => {
        if (isAlbumsList()) return;
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
        if (isAlbumsList()) { filterAlbums(trackSearchInput.value); return; }
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

let searchRequestId = 0;

async function fetchSearchResults(query) {
    if (!cachedToken || !trackSearchSuggestions) return;
    const requestId = ++searchRequestId;

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

        // A faster, more recent keystroke may have already resolved —
        // ignore this response if it's no longer the latest search in flight.
        if (requestId !== searchRequestId || isAlbumsList()) return;
        renderSearchResults(combined);
    } catch (err) {
        if (requestId !== searchRequestId) return;
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
            ${track.image ? `<img class="track-suggestion-img" src="${esc(track.image)}" alt="">` : ""}
            <div class="track-suggestion-meta">
                <span class="track-suggestion-name">${esc(track.name)}</span>
                <span class="track-suggestion-sub">${esc(track.sub)}</span>
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
    const params = getParams();
    const { type, id, size, order, name, saved, rating: ratingParam } = params;

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
        rating = type === "album" ? ratingParam : null;
        // A saved ranking opens as the finished list, unless the URL says it's being edited.
        viewing = Boolean(saved) && !params.edit;

        if (type === "artist" && params.list === "albums") {
            // Start the Top tracks list fresh, then open Albums with the URL's ranking.
            rankSize = sizeOptions[0].value;
            listName = `${meta.name} Top Tracks`;
            await switchList("albums", { restore: { size, order, name, saved } });
        } else {
            rankSize = size && sizeOptions.some(o => o.value === size) ? size : sizeOptions[0].value;
            await addMissingTracks(token, order.slice(0, rankSize));
            rankedIds = order.filter(oid => allTracks.some(t => t.id === oid)).slice(0, rankSize);
            listName = name || defaultListName();
            savedId = saved;
        }

        initMobileTabs();
        initTrackSearch();
        initClearButton();
        initListName();
        initExport();
        initSave();
        refreshDoneButton();

        if (viewing) enterView();
        else enterEdit();

        loadingEl.style.display = "none";
        pageEl.style.display = "block";
    } catch (err) {
        console.error(err);
        loadingEl.innerHTML = `<div class="loading-card"><div class="loading-title">Something went wrong</div><div class="loading-sub">Please try again later.</div></div>`;
    }
}

// Browser back/forward cache restores the exact DOM snapshot, including
// whatever was typed into the search box — clear it so returning to this
// page via back/forward doesn't show stale leftover text.
window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
        if (trackSearchInput) trackSearchInput.value = "";
        hideSuggestions();
    }
});

init();
