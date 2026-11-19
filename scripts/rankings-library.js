// rankings-library.js — "Your saved rankings" on rankings.html: the signed-in user's
// saved rankings as a grid of covers, in tabs: Albums, Artists (with Top tracks /
// Albums & EPs sub-tabs, like the artist ranking page) and Custom. Each section
// (sectionOf in saved-rankings.js: album, artist, artist_albums, favourites) has its own
// folders ("Favourites", "2026 Releases"). Albums show their stars; artists show their
// average stars across the user's rated albums of theirs (artist-ratings.js).
// Adding a ranking to folders and deleting it happen on the ranking's own page
// (rank-view.js); this page lists, filters and opens them, and manages the folders.
import { esc } from "./auth.js";
import { onUserChange } from "./supabase.js";
import {
    listRankings, rankingUrl, KIND_LABELS, sectionOf, foldersForSection,
    loadFolders, createFolder, renameFolder, deleteFolder, FOLDER_LIMIT,
} from "./saved-rankings.js";
import { openNameModal } from "./folder-dialog.js";
import { starsHtml, formatRating } from "./star-rating.js";
import { artistAverages, formatAverage } from "./artist-ratings.js";

const section = document.getElementById("saved-rankings");
const listEl = document.getElementById("saved-rankings-list");
const barEl = document.getElementById("folder-bar");
const toolsEl = document.getElementById("folder-tools");
const sortEl = document.getElementById("sort-toggle");
const typeTabsEl = document.getElementById("type-tabs");
const subTabsEl = document.getElementById("sub-tabs");
const searchEl = document.getElementById("saved-search-input");
const SORT_KEY = "tunevis_saved_sort";

// Top tabs, each covering one or more sections. Albums and Artists are always there;
// Custom (favourite artists / tracks from rank-general.html) once one is saved.
const TABS = [
    { id: "album", label: "Albums", sections: ["album"], always: true },
    { id: "artists", label: "Artists", sections: ["artist", "artist_albums"], always: true },
    { id: "custom", label: "Custom", sections: ["favourites"] },
];
// The Artists tab's sub-tabs, in the same order as the artist ranking page's toggle.
const SUB_TABS = [
    { id: "artist", label: "Top tracks" },
    { id: "artist_albums", label: "Albums & EPs" },
];
// For messages: "No album rankings saved yet."
const NOUNS = { album: "album", artist: "artist top tracks", artist_albums: "artist album", favourites: "custom" };

// ── State ──────────────────────────────────────────────────────────────
let rankings = [];
let folders = [];
let items = [];                 // [{ folder_id, ranking_id }]
let foldersAvailable = false;   // false until the folders migration has been run
let averages = new Map();       // artistId → { average, count }
let active = "all";             // "all" (every ranking in the section) or a folder id
let typeFilter = "album";       // the open section: album | artist | artist_albums | favourites
let sortBy = readSortPreference(); // "recent" or "rating"
let expanded = false;           // long lists show the first COLLAPSED_COUNT until expanded
let query = "";                 // the search box, normalised (searchable())
const COLLAPSED_COUNT = 8;
const CHEVRON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6l4.5 4.5L12.5 6"/></svg>`;
let loadId = 0;

// The chosen sort is a per-browser convenience; the list works without it.
function readSortPreference() {
    try { return localStorage.getItem(SORT_KEY) === "rating" ? "rating" : "recent"; }
    catch { return "recent"; }
}

const isArtistKind = r => r.kind === "artist" || r.kind === "artist_albums";
// The stars a card shows: an album's own rating, or an artist's average.
function ratingOf(r) {
    if (r.kind === "album") return r.rating != null ? Number(r.rating) : null;
    if (isArtistKind(r)) return averages.get(r.source_id)?.average ?? null;
    return null;
}
const newestFirst = (a, b) => String(b.updated_at).localeCompare(String(a.updated_at));

// "rating": rated first, highest stars first (ties: most recent first), then everything
// without stars, most recent first. "recent": most recent first.
function sorted(list) {
    const copy = list.slice();
    if (sortBy !== "rating") return copy.sort(newestFirst);
    return copy.sort((a, b) => {
        const ra = ratingOf(a), rb = ratingOf(b);
        if (ra !== rb) {
            if (ra === null) return 1;
            if (rb === null) return -1;
            return rb - ra;
        }
        return newestFirst(a, b);
    });
}

// Search: case- and accent-insensitive, over the ranking's name, what it ranks (album /
// artist), its kind and its folders. Every word typed has to match somewhere.
const searchable = text => String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function matchesQuery(r) {
    if (!query) return true;
    const haystack = searchable([r.title, r.source_name, KIND_LABELS[r.kind], ...foldersOf(r).map(f => f.name)].join(" "));
    return query.split(/\s+/).every(word => haystack.includes(word));
}
const matching = () => (query ? rankings.filter(matchesQuery) : rankings);

const tabOf = sectionId => TABS.find(t => t.sections.includes(sectionId)) || TABS[0];
const inSection = (list, sectionId) => list.filter(r => sectionOf(r.kind) === sectionId);
const inTabSections = (list, tab) => list.filter(r => tab.sections.includes(sectionOf(r.kind)));
const inTab = () => inSection(matching(), typeFilter);
const tabFolders = () => foldersForSection(folders, typeFilter);
const inFolder = (folderId, list) => list.filter(r => items.some(i => i.folder_id === folderId && i.ranking_id === r.id));
const activeFolder = () => tabFolders().find(f => f.id === active) || null;
const foldersOf = r => foldersForSection(folders, sectionOf(r.kind))
    .filter(f => items.some(i => i.folder_id === f.id && i.ranking_id === r.id));

// The section a top tab opens on: the one already open, else the first with rankings.
function sectionFor(tab) {
    if (tab.sections.includes(typeFilter)) return typeFilter;
    return tab.sections.find(s => rankings.some(r => sectionOf(r.kind) === s)) || tab.sections[0];
}

// The open section and folder live in the URL (?type=<section>&folder=<id>) so they
// survive a reload or coming back from a ranking.
function syncUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set("type", typeFilter);
    if (active === "all") url.searchParams.delete("folder");
    else url.searchParams.set("folder", active);
    history.replaceState(null, "", url);
}

function openSection(sectionId) {
    if (sectionId === typeFilter) return;
    typeFilter = sectionId;
    active = "all";            // each section has its own folders
    expanded = false;
    syncUrl();
    render();
}

// ── Rendering ──────────────────────────────────────────────────────────
function render() {
    if (active !== "all" && !activeFolder()) active = "all";   // e.g. deleted elsewhere
    renderTypeTabs();
    renderSubTabs();
    renderFolderBar();
    renderSortToggle();
    renderList();
    renderFolderTools();
}

function renderTypeTabs() {
    const open = tabOf(typeFilter);
    const shown = TABS.filter(t => t.always || t === open || inTabSections(rankings, t).length);
    typeTabsEl.hidden = false;
    typeTabsEl.innerHTML = shown.map(t => `
        <button type="button" class="type-tab${t === open ? " active" : ""}" data-tab="${t.id}" aria-pressed="${t === open}">
            ${esc(t.label)}<span class="type-tab-count">${inTabSections(matching(), t).length}</span>
        </button>`).join("");
}

typeTabsEl.addEventListener("click", e => {
    const btn = e.target.closest("button[data-tab]");
    const tab = btn && TABS.find(t => t.id === btn.dataset.tab);
    if (tab) openSection(sectionFor(tab));
});

// Top tracks / Albums & EPs under the Artists tab.
function renderSubTabs() {
    const show = tabOf(typeFilter).id === "artists";
    subTabsEl.hidden = !show;
    if (!show) { subTabsEl.innerHTML = ""; return; }
    subTabsEl.innerHTML = SUB_TABS.map(s => `
        <button type="button" class="tab-btn sub-tab${typeFilter === s.id ? " active" : ""}" data-section="${s.id}" aria-pressed="${typeFilter === s.id}">
            ${esc(s.label)}<span class="sub-tab-count">${inSection(matching(), s.id).length}</span>
        </button>`).join("");
}

subTabsEl.addEventListener("click", e => {
    const btn = e.target.closest("button[data-section]");
    if (btn) openSection(btn.dataset.section);
});

function renderSortToggle() {
    sortEl.querySelectorAll("button").forEach(btn => {
        const on = btn.dataset.sort === sortBy;
        btn.classList.toggle("active", on);
        btn.setAttribute("aria-pressed", String(on));
    });
}

sortEl.addEventListener("click", e => {
    const btn = e.target.closest("button[data-sort]");
    if (!btn || btn.dataset.sort === sortBy) return;
    sortBy = btn.dataset.sort;
    try { localStorage.setItem(SORT_KEY, sortBy); } catch {}
    renderSortToggle();
    renderList();
});

function renderFolderBar() {
    barEl.hidden = !foldersAvailable;
    if (!foldersAvailable) return;
    const tab = inTab();
    const chip = (id, label, count) => `
        <button type="button" class="folder-chip${active === id ? " active" : ""}" data-folder="${esc(id)}" aria-pressed="${active === id}">
            <span class="folder-chip-name">${esc(label)}</span><span class="folder-chip-count">${count}</span>
        </button>`;
    barEl.innerHTML =
        chip("all", "All", tab.length) +
        tabFolders().map(f => chip(f.id, f.name, inFolder(f.id, tab).length)).join("") +
        (folders.length < FOLDER_LIMIT
            ? `<button type="button" class="folder-chip folder-chip-new" id="new-folder-btn">+ New folder</button>`
            : "");
}

// Rename / Delete for the open folder, under its list.
function renderFolderTools() {
    toolsEl.hidden = !activeFolder();
}

// A card: large cover, then the name, a short line about it, and its stars.
function rankingCard(r) {
    const card = document.createElement("a");
    card.className = "saved-card";
    card.href = rankingUrl(r);
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

function renderList() {
    const folder = activeFolder();
    const tab = inTab();
    const shown = sorted(folder ? inFolder(folder.id, tab) : tab);
    const noun = NOUNS[typeFilter] || "saved";

    listEl.innerHTML = "";
    if (!shown.length && query) {
        const elsewhere = matching().length;
        listEl.innerHTML = `<p class="tab-empty">No ${esc(noun)} rankings${folder ? ` in "${esc(folder.name)}"` : ""} match "${esc(searchEl.value.trim())}".${
            elsewhere ? ` ${elsewhere} in other tabs${folder ? " or folders" : ""}.` : ""}</p>`;
        return;
    }
    if (!shown.length) {
        listEl.innerHTML = folder
            ? `<p class="tab-empty">Nothing in "${esc(folder.name)}" yet. Open one of your ${esc(noun)} rankings and use Add to folder to put it here.</p>`
            : `<p class="tab-empty">No ${esc(noun)} rankings saved yet. Build one and press Save to keep it here.</p>`;
        return;
    }

    // A long list shows its first few, with an arrow button to show the rest.
    const collapsible = !query && shown.length > COLLAPSED_COUNT;   // search results show in full
    const visible = collapsible && !expanded ? shown.slice(0, COLLAPSED_COUNT) : shown;
    const grid = document.createElement("div");
    grid.className = "saved-grid";
    visible.forEach(r => grid.appendChild(rankingCard(r)));
    listEl.appendChild(grid);
    if (!collapsible) return;

    const more = document.createElement("button");
    more.type = "button";
    more.className = "show-more-btn" + (expanded ? " expanded" : "");
    more.setAttribute("aria-expanded", String(expanded));
    more.innerHTML = expanded
        ? `Show less ${CHEVRON}`
        : `Show all ${shown.length} ${CHEVRON}`;
    more.addEventListener("click", () => {
        expanded = !expanded;
        renderList();
        // After collapsing, bring the top of the list back into view.
        if (!expanded) section.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    listEl.appendChild(more);
}

searchEl?.addEventListener("input", () => {
    const next = searchable(searchEl.value.trim());
    if (next === query) return;
    query = next;
    renderTypeTabs();
    renderSubTabs();
    renderFolderBar();
    renderList();
});

// ── Folder bar and tools ──────────────────────────────────────────────
const sectionLabel = () => tabOf(typeFilter).id === "artists"
    ? `artist ${SUB_TABS.find(s => s.id === typeFilter).label.toLowerCase()}`
    : tabOf(typeFilter).label.toLowerCase();

barEl.addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.id === "new-folder-btn") {
        openNameModal({
            title: `New ${sectionLabel()} folder`,
            button: "Create folder",
            existing: tabFolders(),
            onSave: async name => {
                const result = await createFolder(name, typeFilter);
                if (result.error) return result;
                folders.push(result.folder);
                active = result.folder.id;   // open the new folder straight away
                syncUrl();
                render();
            },
        });
        return;
    }
    if (btn.dataset.folder && btn.dataset.folder !== active) {
        active = btn.dataset.folder;
        expanded = false;
        syncUrl();
        render();
    }
});

document.getElementById("folder-rename").addEventListener("click", () => {
    const folder = activeFolder();
    if (!folder) return;
    openNameModal({
        title: "Rename folder",
        value: folder.name,
        button: "Save name",
        existing: tabFolders(),
        ignoreId: folder.id,
        onSave: async name => {
            const result = await renameFolder(folder.id, name);
            if (result.error) return result;
            folder.name = name;
            render();
        },
    });
});

document.getElementById("folder-delete").addEventListener("click", async () => {
    const folder = activeFolder();
    if (!folder) return;
    if (!confirm(`Delete the folder "${folder.name}"? The rankings in it stay saved.`)) return;
    try {
        await deleteFolder(folder.id);
        folders = folders.filter(f => f.id !== folder.id);
        items = items.filter(i => i.folder_id !== folder.id);
        active = "all";
        syncUrl();
        render();
    } catch (err) {
        console.error(err);
        alert("That folder couldn't be deleted just now. Please try again.");
    }
});

// ── Loading ────────────────────────────────────────────────────────────
const SECTIONS = ["album", "artist", "artist_albums", "favourites"];

async function load(user) {
    if (!section) return;
    const id = ++loadId;
    if (!user) { section.hidden = true; return; }

    section.hidden = false;
    if (!rankings.length) listEl.innerHTML = `<p class="tab-loading">Loading your rankings…</p>`;
    try {
        const [rows, library] = await Promise.all([
            listRankings(),
            loadFolders().catch(err => { console.error(err); return { folders: [], items: [], available: false }; }),
        ]);
        if (id !== loadId) return;
        rankings = rows || [];
        ({ folders, items, available: foldersAvailable } = library);
        const params = new URLSearchParams(window.location.search);
        const wantedType = params.get("type");
        typeFilter = SECTIONS.includes(wantedType) ? wantedType
            : wantedType === "artists" ? sectionFor(TABS[1])
            // no tab asked for: open the first section that has rankings
            : TABS.map(sectionFor).find(s => rankings.some(r => sectionOf(r.kind) === s)) || "album";
        const wanted = params.get("folder");
        active = wanted && tabFolders().some(f => f.id === wanted) ? wanted : "all";
        render();
    } catch (err) {
        if (id !== loadId) return;
        console.error(err);
        listEl.innerHTML = `<p class="tab-empty">Your saved rankings couldn't be loaded just now.</p>`;
        return;
    }
    // Linked from the account page as rankings.html#saved-rankings; the section only
    // appears once loaded, so scroll to it now.
    if (window.location.hash === "#saved-rankings") section.scrollIntoView({ behavior: "smooth" });

    // Artists' average stars may need a Spotify lookup, so they fill in afterwards.
    if (rankings.some(isArtistKind)) {
        const result = await artistAverages(rankings).catch(err => { console.warn(err); return null; });
        if (id !== loadId || !result) return;
        averages = result;
        renderList();
    }
}

let currentUser = null;
onUserChange(user => { currentUser = user; load(user); });

// Coming Back from a ranking (where it may have been deleted, re-rated or filed into a
// folder): the browser can restore this page as it was, so load the list again.
// The search box starts empty every time the page is shown (see CLAUDE.md: browsers
// restore or refill typed text on Back).
window.addEventListener("pageshow", e => {
    if (searchEl && (searchEl.value || query)) { searchEl.value = ""; query = ""; if (rankings.length) render(); }
    if (e.persisted && currentUser) load(currentUser);
});
