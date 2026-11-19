// rankings-library.js — "Your saved rankings" on rankings.html: the signed-in user's
// saved rankings as a grid of covers, in tabs: Albums, Artists (one card per artist,
// covering their top tracks and albums & EPs rankings) and Custom. Each section
// (sectionOf in saved-rankings.js: album, artist, favourites) has its own
// folders ("Favourites", "2026 Releases"). Albums show their stars; artists show their
// average stars across the user's rated albums of theirs (artist-ratings.js).
// Adding a ranking to folders and deleting it happen on the ranking's own page
// (rank-view.js); this page lists, filters and opens them, and manages the folders.
import { esc } from "./auth.js";
import { onUserChange } from "./supabase.js";
import {
    listRankings, KIND_LABELS, sectionOf, foldersForSection,
    loadFolders, createFolder, updateFolder, deleteFolder, FOLDER_LIMIT,
    addToFolder, removeFromFolder,
} from "./saved-rankings.js";
import { openNameModal, openModal } from "./folder-dialog.js";
import { formatRating } from "./star-rating.js";
import { artistAverages, albumArtistNames, loadAlbumArtistNames } from "./artist-ratings.js";
import { rankingCard, isArtistKind, groupArtists } from "./ranking-cards.js";

const section = document.getElementById("saved-rankings");
const listEl = document.getElementById("saved-rankings-list");
const barEl = document.getElementById("folder-bar");
const toolsEl = document.getElementById("folder-tools");
const sortEl = document.getElementById("sort-toggle");
const typeTabsEl = document.getElementById("type-tabs");
const searchEl = document.getElementById("saved-search-input");
const SORT_KEY = "tunevis_saved_sort";

// Top tabs, each covering one or more sections. Albums and Artists are always there;
// Custom (favourite artists / tracks from rank-general.html) once one is saved.
const TABS = [
    { id: "album", label: "Albums", sections: ["album"], always: true },
    { id: "artists", label: "Artists", sections: ["artist"], always: true },
    { id: "custom", label: "Custom", sections: ["favourites"] },
];
// For messages: "No album rankings saved yet."
const NOUNS = { album: "album", artist: "artist", favourites: "custom" };

// ── State ──────────────────────────────────────────────────────────────
let rankings = [];
let folders = [];
let items = [];                 // [{ folder_id, ranking_id }]
let foldersAvailable = false;   // false until the folders migration has been run
let publicFolders = false;      // false until the public-folders migration has been run
const PUBLIC_ICON = `<svg class="folder-chip-public" viewBox="0 0 20 20" aria-hidden="true"><circle cx="7" cy="6.5" r="3.2"/><circle cx="14.2" cy="7.5" r="2.6"/><path d="M1 17c0-3.3 2.7-5.6 6-5.6s6 2.3 6 5.6z"/><path d="M13.6 11.6c3 0 5.4 2 5.4 5.1h-4.6c0-2-.3-3.6-.8-5.1z"/></svg>`;
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

// The stars a card shows: an album's own rating, or an artist's average.
function ratingOf(r) {
    if (r.kind === "album") return r.rating != null ? Number(r.rating) : null;
    if (r.group || isArtistKind(r)) return averages.get(r.source_id)?.average ?? null;
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
// Albums also match their artist's name ("arctic" finds every Arctic Monkeys album):
// from the remembered album credits (artist-ratings.js), or, until those are known, the
// artists on the ranked tracks.
function artistWords(r) {
    if (r.kind !== "album") return [];
    const names = albumArtistNames(r.source_id);
    return names.length ? names : (r.items || []).map(i => i.subtitle).filter(Boolean);
}

function matchesQuery(r) {
    if (!query) return true;
    const haystack = searchable([r.title, r.source_name, KIND_LABELS[r.kind], ...artistWords(r), ...foldersOf(r).map(f => f.name)].join(" "));
    return query.split(/\s+/).every(word => haystack.includes(word));
}
const matching = () => (query ? rankings.filter(matchesQuery) : rankings);

const tabOf = sectionId => TABS.find(t => t.sections.includes(sectionId)) || TABS[0];
const inSection = (list, sectionId) => list.filter(r => sectionOf(r.kind) === sectionId);
const inTabSections = (list, tab) => list.filter(r => tab.sections.includes(sectionOf(r.kind)));
// The cards in the open tab: each artist's rankings make one card (groupArtists).
const inTab = () => groupArtists(inSection(matching(), typeFilter));
const entryIds = e => (e.group ? e.rankings.map(r => r.id) : [e.id]);
const tabFolders = () => foldersForSection(folders, typeFilter);
// An artist's card is in a folder when either of their rankings is.
const inFolder = (folderId, list) => list.filter(e => entryIds(e).some(id => items.some(i => i.folder_id === folderId && i.ranking_id === id)));
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
            ${esc(t.label)}<span class="type-tab-count">${groupArtists(inTabSections(matching(), t)).length}</span>
        </button>`).join("");
}

typeTabsEl.addEventListener("click", e => {
    const btn = e.target.closest("button[data-tab]");
    const tab = btn && TABS.find(t => t.id === btn.dataset.tab);
    if (tab) openSection(sectionFor(tab));
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
    // Folders friends can see carry a small people icon.
    const chip = (id, label, count, shared = false) => `
        <button type="button" class="folder-chip${active === id ? " active" : ""}" data-folder="${esc(id)}" aria-pressed="${active === id}"${shared ? ` title="Friends can see this folder"` : ""}>
            ${shared ? PUBLIC_ICON : ""}<span class="folder-chip-name">${esc(label)}</span><span class="folder-chip-count">${count}</span>
        </button>`;
    barEl.innerHTML =
        chip("all", "All", tab.length) +
        tabFolders().map(f => chip(f.id, f.name, inFolder(f.id, tab).length, f.is_public)).join("") +
        (folders.length < FOLDER_LIMIT
            ? `<button type="button" class="folder-chip folder-chip-new" id="new-folder-btn">+ New folder</button>`
            : "");
}

// Rename / Delete for the open folder, under its list.
function renderFolderTools() {
    const folder = activeFolder();
    toolsEl.hidden = !folder;
    const note = document.getElementById("folder-visibility-note");
    if (note) {
        note.hidden = !folder || !publicFolders;
        note.textContent = folder?.is_public ? "Friends can see this folder on your profile." : "Only you can see this folder.";
    }
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
            ? `<p class="tab-empty">Nothing in "${esc(folder.name)}" yet. Press <strong>+ Add rankings</strong> below to fill it.</p>`
            : `<p class="tab-empty">No ${esc(noun)} rankings saved yet. Build one and press Save to keep it here.</p>`;
        return;
    }

    // A long list shows its first few, with an arrow button to show the rest.
    const collapsible = !query && shown.length > COLLAPSED_COUNT;   // search results show in full
    const visible = collapsible && !expanded ? shown.slice(0, COLLAPSED_COUNT) : shown;
    const grid = document.createElement("div");
    grid.className = "saved-grid";
    visible.forEach(r => grid.appendChild(rankingCard(r, { averages })));
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
    renderFolderBar();
    renderList();
});

// ── Folder bar and tools ──────────────────────────────────────────────
const sectionLabel = () => tabOf(typeFilter).label.toLowerCase();

barEl.addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.id === "new-folder-btn") {
        openNameModal({
            title: `New ${sectionLabel()} folder`,
            button: "Create folder",
            existing: tabFolders(),
            isPublic: publicFolders ? false : undefined,
            onSave: async (name, isPublic) => {
                const result = await createFolder(name, typeFilter, Boolean(isPublic));
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
        title: "Edit folder",
        value: folder.name,
        button: "Save",
        existing: tabFolders(),
        ignoreId: folder.id,
        isPublic: publicFolders ? folder.is_public : undefined,
        onSave: async (name, isPublic) => {
            const result = await updateFolder(folder.id, { name, isPublic });
            if (result.error) return result;
            folder.name = name;
            if (isPublic !== undefined) folder.is_public = isPublic;
            render();
        },
    });
});

// ── Add rankings to the open folder ───────────────────────────────────
// A pop-up listing every saved ranking that can go in this folder (the folder's kind;
// artists as one row each), with a search box. Ticking a row adds it straight away,
// unticking takes it out. An artist's row covers both of their rankings.
function openAddToFolder(folder) {
    const entries = sorted(groupArtists(inSection(rankings, typeFilter)));
    const idsOf = e => (e.group ? e.rankings.map(r => r.id) : [e.id]);
    const isIn = e => idsOf(e).some(id => items.some(i => i.folder_id === folder.id && i.ranking_id === id));
    const words = e => searchable([e.title, e.source_name, KIND_LABELS[e.kind],
        ...(e.group ? [] : artistWords(e))].join(" "));

    const { modal } = openModal(`
        <h2>Add to "${esc(folder.name)}"</h2>
        <label class="saved-search picker-search">
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M12.8 12.8l4.4 4.4"/></svg>
            <input type="search" placeholder="Search your ${esc(NOUNS[typeFilter] || "")} rankings" autocomplete="off" aria-label="Search your rankings">
        </label>
        <p class="picker-count" aria-live="polite"></p>
        <div class="picker-list"></div>
        <p class="username-status error" aria-live="polite"></p>
        <button type="button" class="picker-done">Done</button>`);
    modal.querySelector(".library-modal-card").classList.add("picker-card");
    const listBox = modal.querySelector(".picker-list");
    const input = modal.querySelector("input[type=search]");
    const errorEl = modal.querySelector(".username-status");
    const countEl = modal.querySelector(".picker-count");

    const row = e => {
        const round = e.group || ["artist", "artist_albums", "fav_artists"].includes(e.kind) ? " round" : "";
        const sub = e.group
            ? [e.tracks && "Top tracks", e.albums && "Albums & EPs"].filter(Boolean).join(" · ")
            : [e.source_name && e.source_name !== e.title ? e.source_name : null, e.kind === "album" && e.rating != null ? `${formatRating(Number(e.rating))} stars` : null].filter(Boolean).join(" · ");
        return `<label class="picker-row">
            <input type="checkbox" value="${esc(e.id)}"${isIn(e) ? " checked" : ""}>
            ${e.image ? `<img class="picker-img${round}" src="${esc(e.image)}" alt="" loading="lazy">` : `<span class="picker-img${round}"></span>`}
            <span class="picker-text"><span class="picker-name">${esc(e.title)}</span>${sub ? `<span class="picker-sub">${esc(sub)}</span>` : ""}</span>
        </label>`;
    };

    function draw() {
        const q = searchable(input.value.trim());
        const shown = q ? entries.filter(e => q.split(/\s+/).every(w => words(e).includes(w))) : entries;
        const inCount = entries.filter(isIn).length;
        countEl.textContent = `${inCount} of ${entries.length} in this folder`;
        listBox.innerHTML = shown.length
            ? shown.map(row).join("")
            : `<p class="library-modal-empty">${entries.length ? "Nothing matches that search." : "You haven't saved any rankings of this kind yet."}</p>`;
    }

    input.addEventListener("input", draw);
    listBox.addEventListener("change", async e => {
        const box = e.target;
        if (box.type !== "checkbox") return;
        const entry = entries.find(x => x.id === box.value);
        if (!entry) return;
        errorEl.textContent = "";
        box.disabled = true;
        // An artist's row: add their newest ranking, or take out all of theirs.
        const ids = entry.group ? (box.checked ? [entry.rankings[0].id] : idsOf(entry)) : [entry.id];
        try {
            for (const id of ids) {
                if (box.checked) {
                    await addToFolder(folder.id, id);
                    if (!items.some(i => i.folder_id === folder.id && i.ranking_id === id)) items.push({ folder_id: folder.id, ranking_id: id });
                } else {
                    await removeFromFolder(folder.id, id);
                    items = items.filter(i => !(i.folder_id === folder.id && i.ranking_id === id));
                }
            }
            countEl.textContent = `${entries.filter(isIn).length} of ${entries.length} in this folder`;
            render();   // the folder's list and counts behind the pop-up
        } catch (err) {
            console.error(err);
            box.checked = !box.checked;
            errorEl.textContent = "That change couldn't be saved just now. Please try again.";
        } finally {
            box.disabled = false;
        }
    });
    modal.querySelector(".picker-done").addEventListener("click", () => modal.querySelector(".site-info-close").click());

    draw();
    // Focus the search on desktop only: on phones it would pop the keyboard over the list.
    if (window.matchMedia("(hover: hover)").matches) input.focus();
}

document.getElementById("folder-add").addEventListener("click", () => {
    const folder = activeFolder();
    if (folder) openAddToFolder(folder);
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
const SECTIONS = ["album", "artist", "favourites"];

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
        ({ folders, items, available: foldersAvailable, publicFolders = false } = library);
        const params = new URLSearchParams(window.location.search);
        const wantedType = params.get("type");
        typeFilter = SECTIONS.includes(wantedType) ? wantedType
            : wantedType === "artists" || wantedType === "artist_albums" ? "artist"   // old links
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

    // Albums' artists (for searching by artist) may need a Spotify lookup too.
    const albumIds = rankings.filter(r => r.kind === "album" && r.source_id).map(r => r.source_id);
    if (albumIds.length) {
        loadAlbumArtistNames(albumIds)
            .then(() => { if (id === loadId && query) { renderTypeTabs(); renderFolderBar(); renderList(); } })
            .catch(err => console.warn(err));
    }

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
