// rankings-library.js — "Your saved rankings" on rankings.html: the signed-in user's
// saved rankings in tabs by kind (Albums, Artist albums & EPs, ...). Each tab has its
// own folders ("Favourites", "2026 Releases"). Album rankings show their star rating.
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

const section = document.getElementById("saved-rankings");
const listEl = document.getElementById("saved-rankings-list");
const barEl = document.getElementById("folder-bar");
const toolsEl = document.getElementById("folder-tools");
const sortEl = document.getElementById("sort-toggle");
const typeTabsEl = document.getElementById("type-tabs");
const SORT_KEY = "tunevis_saved_sort";

// Tabs by section (sectionOf in saved-rankings.js). Albums and artist albums are
// always there; the others appear once there's a ranking of that kind.
const TYPE_TABS = [
    { id: "album", label: "Albums", always: true },
    { id: "artist_albums", label: "Artist albums & EPs", always: true },
    { id: "artist", label: "Artist top tracks" },
    { id: "favourites", label: "Favourite artists & tracks" },
];

// ── State ──────────────────────────────────────────────────────────────
let rankings = [];
let folders = [];
let items = [];                 // [{ folder_id, ranking_id }]
let foldersAvailable = false;   // false until the folders migration has been run
let active = "all";             // "all" (every ranking in the tab) or a folder id
let typeFilter = "album";       // a TYPE_TABS id
let sortBy = readSortPreference(); // "recent" or "rating"
let expanded = false;           // long lists show the first COLLAPSED_COUNT until expanded
const COLLAPSED_COUNT = 6;
const CHEVRON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6l4.5 4.5L12.5 6"/></svg>`;
let loadId = 0;

// The chosen sort is a per-browser convenience; the list works without it.
function readSortPreference() {
    try { return localStorage.getItem(SORT_KEY) === "rating" ? "rating" : "recent"; }
    catch { return "recent"; }
}

const ratingOf = r => (r.kind === "album" && r.rating != null ? Number(r.rating) : null);
const newestFirst = (a, b) => String(b.updated_at).localeCompare(String(a.updated_at));

// "rating": rated albums first, highest stars first (ties: most recent first), then
// everything without a rating, most recent first. "recent": most recent first.
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

const typeTab = id => TYPE_TABS.find(t => t.id === id) || null;
const inTab = () => rankings.filter(r => sectionOf(r.kind) === typeFilter);
const tabFolders = () => foldersForSection(folders, typeFilter);
const inFolder = (folderId, list) => list.filter(r => items.some(i => i.folder_id === folderId && i.ranking_id === r.id));
const activeFolder = () => tabFolders().find(f => f.id === active) || null;
const foldersOf = r => foldersForSection(folders, sectionOf(r.kind))
    .filter(f => items.some(i => i.folder_id === f.id && i.ranking_id === r.id));

// The open tab and folder live in the URL (?type=<tab>&folder=<id>) so they survive
// a reload or coming back from a ranking.
function syncUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set("type", typeFilter);
    if (active === "all") url.searchParams.delete("folder");
    else url.searchParams.set("folder", active);
    history.replaceState(null, "", url);
}

// ── Rendering ──────────────────────────────────────────────────────────
function render() {
    if (active !== "all" && !activeFolder()) active = "all";   // e.g. deleted elsewhere
    renderTypeTabs();
    renderFolderBar();
    renderSortToggle();
    renderList();
    renderFolderTools();
}

function renderTypeTabs() {
    const shown = TYPE_TABS.filter(t => t.always || t.id === typeFilter
        || rankings.some(r => sectionOf(r.kind) === t.id));
    typeTabsEl.hidden = false;
    typeTabsEl.innerHTML = shown.map(t => `
        <button type="button" class="type-tab${typeFilter === t.id ? " active" : ""}" data-type="${t.id}" aria-pressed="${typeFilter === t.id}">
            ${esc(t.label)}<span class="type-tab-count">${rankings.filter(r => sectionOf(r.kind) === t.id).length}</span>
        </button>`).join("");
}

typeTabsEl.addEventListener("click", e => {
    const btn = e.target.closest("button[data-type]");
    if (!btn || btn.dataset.type === typeFilter) return;
    typeFilter = btn.dataset.type;
    active = "all";            // each tab has its own folders
    expanded = false;
    syncUrl();
    render();
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

function rankingRow(r) {
    const row = document.createElement("div");
    row.className = "saved-ranking";
    const count = r.item_ids?.length || 0;
    const kindLabel = KIND_LABELS[r.kind] || "Ranking";
    const about = r.source_name ? ` · ${r.source_name}` : "";
    const updated = new Date(r.updated_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    const round = ["artist", "artist_albums", "fav_artists"].includes(r.kind) ? " round" : "";
    const rating = ratingOf(r);
    const tags = foldersOf(r).filter(f => f.id !== active);

    row.innerHTML = `
        <a class="saved-ranking-open" href="${esc(rankingUrl(r))}">
            ${r.image ? `<img class="saved-ranking-img${round}" src="${esc(r.image)}" alt="">` : `<div class="saved-ranking-img${round}"></div>`}
            <div class="saved-ranking-meta">
                <span class="saved-ranking-name">${esc(r.title)}</span>
                <span class="saved-ranking-sub">${esc(kindLabel + about)} · ${count ? `${count} ranked` : "tracks not ranked yet"} · ${esc(updated)}</span>
                ${rating ? `<span class="saved-ranking-rating">${starsHtml(rating, { size: 13 })}<span>${formatRating(rating)}</span></span>` : ""}
                ${tags.length ? `<span class="saved-ranking-folders">${tags.map(f => `<span class="folder-tag">${esc(f.name)}</span>`).join("")}</span>` : ""}
            </div>
            <span class="saved-ranking-chevron" aria-hidden="true">&#8250;</span>
        </a>`;
    return row;
}

function renderList() {
    const folder = activeFolder();
    const tab = inTab();
    const shown = sorted(folder ? inFolder(folder.id, tab) : tab);
    const noun = typeTab(typeFilter).label.toLowerCase();

    listEl.innerHTML = "";
    if (!shown.length) {
        listEl.innerHTML = folder
            ? `<p class="tab-empty">Nothing in "${esc(folder.name)}" yet. Open one of your ${esc(noun)} rankings and use Add to folder to put it here.</p>`
            : `<p class="tab-empty">No ${esc(noun)} rankings saved yet. Build one and press Save to keep it here.</p>`;
        return;
    }

    // A long list shows its first few, with an arrow button to show the rest.
    const collapsible = shown.length > COLLAPSED_COUNT;
    const visible = collapsible && !expanded ? shown.slice(0, COLLAPSED_COUNT) : shown;
    visible.forEach(r => listEl.appendChild(rankingRow(r)));
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

// ── Folder bar and tools ──────────────────────────────────────────────
barEl.addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.id === "new-folder-btn") {
        const label = typeTab(typeFilter).label;
        openNameModal({
            title: `New ${label.toLowerCase()} folder`,
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
        typeFilter = typeTab(wantedType)?.id
            // no tab asked for: open the first one that has rankings
            || TYPE_TABS.find(t => rankings.some(r => sectionOf(r.kind) === t.id))?.id
            || "album";
        const wanted = params.get("folder");
        active = wanted && tabFolders().some(f => f.id === wanted) ? wanted : "all";
        render();
    } catch (err) {
        if (id !== loadId) return;
        console.error(err);
        listEl.innerHTML = `<p class="tab-empty">Your saved rankings couldn't be loaded just now.</p>`;
    }
    // Linked from the account page as rankings.html#saved-rankings; the section only
    // appears once loaded, so scroll to it now.
    if (window.location.hash === "#saved-rankings") section.scrollIntoView({ behavior: "smooth" });
}

let currentUser = null;
onUserChange(user => { currentUser = user; load(user); });

// Coming Back from a ranking (where it may have been deleted or filed into a folder):
// the browser can restore this page as it was, so load the list again.
window.addEventListener("pageshow", e => { if (e.persisted && currentUser) load(currentUser); });
