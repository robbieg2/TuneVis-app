// rankings-library.js — "Your saved rankings" on rankings.html: the signed-in user's
// saved rankings, organised into folders ("Favourites", "2026 Releases", ...).
// A ranking can be in several folders. Album rankings show their star rating.
import { esc } from "./auth.js";
import { onUserChange } from "./supabase.js";
import {
    listRankings, deleteRanking, rankingUrl, KIND_LABELS,
    loadFolders, createFolder, renameFolder, deleteFolder, addToFolder, removeFromFolder,
    folderNameProblem, FOLDER_NAME_MAX, FOLDER_LIMIT,
} from "./saved-rankings.js";
import { starsHtml, formatRating } from "./star-rating.js";

const section = document.getElementById("saved-rankings");
const listEl = document.getElementById("saved-rankings-list");
const barEl = document.getElementById("folder-bar");
const toolsEl = document.getElementById("folder-tools");
const sortEl = document.getElementById("sort-toggle");
const typeTabsEl = document.getElementById("type-tabs");
const SORT_KEY = "tunevis_saved_sort";

// Tabs by kind of ranking, so an artist's albums & EPs rankings sit apart from
// single-album rankings. They combine with folders (e.g. albums in "Favourites").
const TYPE_TABS = [
    { id: "all", label: "All", kinds: null },
    { id: "album", label: "Albums", kinds: ["album"] },
    { id: "artist_albums", label: "Artist albums & EPs", kinds: ["artist_albums"] },
    { id: "artist", label: "Artist top tracks", kinds: ["artist"] },
    { id: "favourites", label: "Favourite artists & tracks", kinds: ["fav_artists", "fav_tracks"] },
];

const FOLDER_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h3.76a2 2 0 0 1 1.42.59L12.1 6H18.5A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>`;
const TRASH_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z"/></svg>`;

// ── State ──────────────────────────────────────────────────────────────
let rankings = [];
let folders = [];
let items = [];                 // [{ folder_id, ranking_id }]
let foldersAvailable = false;   // false until the folders migration has been run
let active = "all";             // "all" or a folder id
let typeFilter = "all";         // a TYPE_TABS id
let sortBy = readSortPreference(); // "recent" or "rating"
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

const foldersOf = rankingId => folders.filter(f => items.some(i => i.folder_id === f.id && i.ranking_id === rankingId));
const countIn = folderId => items.filter(i => i.folder_id === folderId && rankings.some(r => r.id === i.ranking_id)).length;
const activeFolder = () => folders.find(f => f.id === active) || null;

// The open folder and kind live in the URL (?folder=<id>&type=<kind>) so they
// survive a reload or going back.
function syncFolderUrl() {
    const url = new URL(window.location.href);
    if (active === "all") url.searchParams.delete("folder");
    else url.searchParams.set("folder", active);
    if (typeFilter === "all") url.searchParams.delete("type");
    else url.searchParams.set("type", typeFilter);
    history.replaceState(null, "", url);
}

// Rankings in the open folder (all of them on "All").
function inActiveFolder() {
    const folder = activeFolder();
    return folder
        ? rankings.filter(r => items.some(i => i.folder_id === folder.id && i.ranking_id === r.id))
        : rankings;
}

const typeTab = id => TYPE_TABS.find(t => t.id === id) || TYPE_TABS[0];
const ofType = (list, id) => {
    const kinds = typeTab(id).kinds;
    return kinds ? list.filter(r => kinds.includes(r.kind)) : list;
};

// ── Rendering ──────────────────────────────────────────────────────────
function render() {
    renderFolderBar();
    renderTypeTabs();
    renderSortToggle();
    renderList();
}

// One tab per kind that has rankings in the open folder, with counts. Hidden when
// everything is one kind, since there'd be nothing to choose between.
function renderTypeTabs() {
    const scope = inActiveFolder();
    const present = TYPE_TABS.filter(t => t.kinds && ofType(scope, t.id).length);
    if (typeFilter !== "all" && !present.some(t => t.id === typeFilter)) {
        typeFilter = "all";   // that kind has nothing here any more
        syncFolderUrl();
    }
    typeTabsEl.hidden = present.length < 2 && typeFilter === "all";
    if (typeTabsEl.hidden) { typeTabsEl.innerHTML = ""; return; }
    typeTabsEl.innerHTML = [TYPE_TABS[0], ...present].map(t => `
        <button type="button" class="type-tab${typeFilter === t.id ? " active" : ""}" data-type="${t.id}" aria-pressed="${typeFilter === t.id}">
            ${esc(t.label)}<span class="type-tab-count">${ofType(scope, t.id).length}</span>
        </button>`).join("");
}

typeTabsEl.addEventListener("click", e => {
    const btn = e.target.closest("button[data-type]");
    if (!btn || btn.dataset.type === typeFilter) return;
    typeFilter = btn.dataset.type;
    syncFolderUrl();
    renderTypeTabs();
    renderList();
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
    toolsEl.hidden = !activeFolder();
    if (!foldersAvailable) return;

    const chip = (id, label, count) => `
        <button type="button" class="folder-chip${active === id ? " active" : ""}" data-folder="${esc(id)}" aria-pressed="${active === id}">
            <span class="folder-chip-name">${esc(label)}</span><span class="folder-chip-count">${count}</span>
        </button>`;
    barEl.innerHTML =
        chip("all", "All", rankings.length) +
        folders.map(f => chip(f.id, f.name, countIn(f.id))).join("") +
        (folders.length < FOLDER_LIMIT
            ? `<button type="button" class="folder-chip folder-chip-new" id="new-folder-btn">+ New folder</button>`
            : "");
}

function rankingRow(r) {
    const row = document.createElement("div");
    row.className = "saved-ranking";
    const count = r.item_ids?.length || 0;
    const kindLabel = KIND_LABELS[r.kind] || "Ranking";
    const about = r.source_name ? ` · ${r.source_name}` : "";
    const updated = new Date(r.updated_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    const round = ["artist", "artist_albums", "fav_artists"].includes(r.kind) ? " round" : "";
    const rating = r.kind === "album" && r.rating != null ? Number(r.rating) : null;
    const inFolders = foldersOf(r.id).filter(f => f.id !== active);

    row.innerHTML = `
        <a class="saved-ranking-open" href="${esc(rankingUrl(r))}">
            ${r.image ? `<img class="saved-ranking-img${round}" src="${esc(r.image)}" alt="">` : `<div class="saved-ranking-img${round}"></div>`}
            <div class="saved-ranking-meta">
                <span class="saved-ranking-name">${esc(r.title)}</span>
                <span class="saved-ranking-sub">${esc(kindLabel + about)} · ${count ? `${count} ranked` : "tracks not ranked yet"} · ${esc(updated)}</span>
                ${rating ? `<span class="saved-ranking-rating">${starsHtml(rating, { size: 13 })}<span>${formatRating(rating)}</span></span>` : ""}
                ${inFolders.length ? `<span class="saved-ranking-folders">${inFolders.map(f => `<span class="folder-tag">${esc(f.name)}</span>`).join("")}</span>` : ""}
            </div>
        </a>
        <div class="saved-ranking-actions">
            ${foldersAvailable ? `<button type="button" class="icon-btn folder-btn" title="Folders" aria-label="Folders for ${esc(r.title)}">${FOLDER_ICON}</button>` : ""}
            <button type="button" class="icon-btn delete-btn" title="Delete ranking" aria-label="Delete ${esc(r.title)}">${TRASH_ICON}</button>
        </div>
    `;

    row.querySelector(".folder-btn")?.addEventListener("click", () => openFoldersModal(r));
    row.querySelector(".delete-btn").addEventListener("click", async e => {
        if (!confirm(`Delete "${r.title}"? This can't be undone.`)) return;
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
            await deleteRanking(r.id);
            rankings = rankings.filter(x => x.id !== r.id);
            items = items.filter(i => i.ranking_id !== r.id);   // the database cascades these too
            render();
        } catch (err) {
            console.error(err);
            btn.disabled = false;
            alert("That ranking couldn't be deleted just now. Please try again.");
        }
    });
    return row;
}

function renderList() {
    const folder = activeFolder();
    const shown = sorted(ofType(inActiveFolder(), typeFilter));

    listEl.innerHTML = "";
    if (!shown.length && typeFilter !== "all") {
        listEl.innerHTML = `<p class="tab-empty">No ${esc(typeTab(typeFilter).label.toLowerCase())} rankings${folder ? ` in "${esc(folder.name)}"` : ""} yet.</p>`;
        return;
    }
    if (!shown.length) {
        listEl.innerHTML = folder
            ? `<p class="tab-empty">Nothing in "${esc(folder.name)}" yet. Use the folder button on any ranking to add it here.</p>`
            : `<p class="tab-empty">Nothing saved yet. Build a ranking and press Save to keep it here.</p>`;
        return;
    }
    shown.forEach(r => listEl.appendChild(rankingRow(r)));
}

// ── Modals ─────────────────────────────────────────────────────────────
function openModal(innerHtml) {
    document.getElementById("library-modal")?.remove();
    const modal = document.createElement("div");
    modal.id = "library-modal";
    modal.className = "site-info-modal open";
    modal.innerHTML = `<div class="site-info-card library-modal-card" role="dialog" aria-modal="true">
        <button class="site-info-close" type="button" aria-label="Close">X</button>${innerHtml}</div>`;
    document.body.appendChild(modal);
    const close = () => { modal.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = e => { if (e.key === "Escape") close(); };
    modal.querySelector(".site-info-close").addEventListener("click", close);
    modal.addEventListener("click", e => { if (e.target === modal) close(); });
    document.addEventListener("keydown", onKey);
    return { modal, close };
}

// Name a new folder or rename one. onSave(name) → { error } | anything else on success.
function openNameModal({ title, value = "", button, onSave, ignoreId = null }) {
    const { modal, close } = openModal(`
        <h2>${esc(title)}</h2>
        <form class="auth-form folder-name-form" novalidate>
            <label class="auth-field">
                <span>Folder name</span>
                <input type="text" name="name" maxlength="${FOLDER_NAME_MAX}" autocomplete="off" placeholder="e.g. Favourites, 2026 Releases">
            </label>
            <p class="username-status error" aria-live="polite"></p>
            <button type="submit">${esc(button)}</button>
        </form>`);
    const form = modal.querySelector("form");
    const input = form.elements.name;
    const errorEl = form.querySelector(".username-status");
    input.value = value;
    input.focus();
    input.select();
    form.addEventListener("submit", async e => {
        e.preventDefault();
        const problem = folderNameProblem(input.value, folders, ignoreId);
        if (problem) { errorEl.textContent = problem; return; }
        form.querySelector("button").disabled = true;
        const result = await onSave(input.value.trim());
        form.querySelector("button").disabled = false;
        if (result?.error) { errorEl.textContent = result.error; return; }
        close();
    });
}

// Tick the folders a ranking belongs in. Changes save as soon as a box is ticked.
function openFoldersModal(r) {
    const { modal } = openModal(`
        <h2>Folders</h2>
        <p class="library-modal-sub">${esc(r.title)}</p>
        <div class="folder-checklist"></div>
        <form class="folder-quick-add" novalidate>
            <input type="text" name="name" maxlength="${FOLDER_NAME_MAX}" autocomplete="off" placeholder="New folder name" aria-label="New folder name">
            <button type="submit" class="secondary-btn">Add</button>
        </form>
        <p class="username-status error" aria-live="polite"></p>`);
    const listBox = modal.querySelector(".folder-checklist");
    const errorEl = modal.querySelector(".username-status");

    function drawChecklist() {
        if (!folders.length) {
            listBox.innerHTML = `<p class="library-modal-empty">No folders yet. Create one below.</p>`;
            return;
        }
        listBox.innerHTML = folders.map(f => {
            const inIt = items.some(i => i.folder_id === f.id && i.ranking_id === r.id);
            return `<label class="folder-check"><input type="checkbox" value="${esc(f.id)}"${inIt ? " checked" : ""}><span>${esc(f.name)}</span></label>`;
        }).join("");
    }

    listBox.addEventListener("change", async e => {
        const box = e.target;
        if (box.type !== "checkbox") return;
        errorEl.textContent = "";
        box.disabled = true;
        try {
            if (box.checked) {
                await addToFolder(box.value, r.id);
                items.push({ folder_id: box.value, ranking_id: r.id });
            } else {
                await removeFromFolder(box.value, r.id);
                items = items.filter(i => !(i.folder_id === box.value && i.ranking_id === r.id));
            }
            render();
        } catch (err) {
            console.error(err);
            box.checked = !box.checked;
            errorEl.textContent = "That change couldn't be saved just now. Please try again.";
        } finally {
            box.disabled = false;
        }
    });

    // Create a folder and put this ranking straight into it.
    const quick = modal.querySelector(".folder-quick-add");
    quick.addEventListener("submit", async e => {
        e.preventDefault();
        const name = quick.elements.name.value;
        const problem = folderNameProblem(name, folders);
        if (problem) { errorEl.textContent = problem; return; }
        if (folders.length >= FOLDER_LIMIT) { errorEl.textContent = `You can have up to ${FOLDER_LIMIT} folders.`; return; }
        errorEl.textContent = "";
        const created = await createFolder(name);
        if (created.error) { errorEl.textContent = created.error; return; }
        folders.push(created.folder);
        try {
            await addToFolder(created.folder.id, r.id);
            items.push({ folder_id: created.folder.id, ranking_id: r.id });
        } catch (err) { console.error(err); }
        quick.reset();
        drawChecklist();
        render();
    });

    drawChecklist();
}

// ── Folder bar and tools ──────────────────────────────────────────────
barEl.addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.id === "new-folder-btn") {
        openNameModal({
            title: "New folder",
            button: "Create folder",
            onSave: async name => {
                const result = await createFolder(name);
                if (result.error) return result;
                folders.push(result.folder);
                active = result.folder.id;   // open the new folder straight away
                syncFolderUrl();
                render();
            },
        });
        return;
    }
    if (btn.dataset.folder) {
        active = btn.dataset.folder;
        syncFolderUrl();
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
        syncFolderUrl();
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
    listEl.innerHTML = `<p class="tab-loading">Loading your rankings…</p>`;
    try {
        const [rows, library] = await Promise.all([
            listRankings(),
            loadFolders().catch(err => { console.error(err); return { folders: [], items: [], available: false }; }),
        ]);
        if (id !== loadId) return;
        rankings = rows || [];
        ({ folders, items, available: foldersAvailable } = library);
        const params = new URLSearchParams(window.location.search);
        const wanted = params.get("folder");
        active = wanted && folders.some(f => f.id === wanted) ? wanted : "all";
        typeFilter = typeTab(params.get("type")).id;
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

onUserChange(load);
