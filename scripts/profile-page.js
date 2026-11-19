// profile-page.js — profile.html?u=<username>: someone's TuneVis profile. Friends (and
// you, on your own) see their saved rankings as cover cards in Albums / Artists /
// Custom tabs; anyone else sees the friend button only. Friends' rankings open
// read-only (rankingUrl(r, { friend: true })). A Most recent / Highest stars switch
// (shared with the saved rankings page's choice) and their public folders as chips
// filter and order the cards. Pinned favourites (rankings.pinned_at) sit in a row at
// the top; on your own profile each card has a pin button (up to PIN_LIMIT).
import { esc } from "./auth.js";
import { onUserChange, loginUrl } from "./supabase.js";
import { sectionOf, setPinned, PIN_LIMIT } from "./saved-rankings.js";
import { artistAverages } from "./artist-ratings.js";
import { rankingCard, groupArtists } from "./ranking-cards.js";
import { profileByUsername, loadFriends, relationTo, rankingsOf, publicFoldersOf } from "./social-data.js";
import { avatarHtml, relationButtonsHtml, runRelationAction } from "./social-ui.js";

const headEl = document.getElementById("profile-head");
const bodyEl = document.getElementById("profile-body");
const backBtn = document.getElementById("back-btn");

backBtn?.addEventListener("click", () => {
    if (history.length > 1) history.back();
    else window.location.href = "social.html";
});

const TABS = [
    { id: "albums", label: "Albums", sections: ["album"] },
    { id: "artists", label: "Artists", sections: ["artist", "artist_albums"] },
    { id: "custom", label: "Custom", sections: ["favourites"] },
];

let profile = null;     // { user_id, username }
let friendsData = null;
let rankings = [];
let averages = new Map();
let openTabId = null;
let publicFolders = { folders: [], items: [] };
let openFolderId = "all";
let loadId = 0;

// Most recent / Highest stars: the same per-browser choice as the saved rankings page.
const SORT_KEY = "tunevis_saved_sort";
let sortBy = (() => { try { return localStorage.getItem(SORT_KEY) === "rating" ? "rating" : "recent"; } catch { return "recent"; } })();

// An album's stars, or an artist's average across their rated albums.
function ratingOf(r) {
    if (r.kind === "album") return r.rating != null ? Number(r.rating) : null;
    if (r.group || r.kind === "artist" || r.kind === "artist_albums") return averages.get(r.source_id)?.average ?? null;
    return null;
}
const newestFirst = (a, b) => String(b.updated_at).localeCompare(String(a.updated_at));
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

const message = html => { bodyEl.innerHTML = `<div class="social-empty">${html}</div>`; };

function renderHead() {
    const rel = relationTo(profile.user_id, friendsData);
    headEl.innerHTML = `
        ${avatarHtml(profile.username, 76)}
        <div class="profile-head-text">
            <h1 class="profile-name">@${esc(profile.username)}</h1>
            ${rel.status === "self" ? `<p class="profile-sub">This is how your friends see your profile.</p>` : ""}
            <div class="person-actions profile-actions">${relationButtonsHtml(rel)}</div>
        </div>`;
    document.title = `@${profile.username} — TuneVis`;
}

headEl.addEventListener("click", async e => {
    const btn = e.target.closest(".person-btn[data-action]");
    if (!btn) return;
    const rel = relationTo(profile.user_id, friendsData);
    headEl.querySelectorAll("button").forEach(b => { b.disabled = true; });
    try {
        const status = await runRelationAction(btn.dataset.action, { userId: profile.user_id, username: profile.username, rel });
        if (status !== null) { friendsData = await loadFriends(); await showProfile(); return; }
    } catch (err) {
        console.error(err);
        alert("That didn't go through just now. Please try again.");
    }
    headEl.querySelectorAll("button").forEach(b => { b.disabled = false; });
});

function renderRankings() {
    const self = relationTo(profile.user_id, friendsData).status === "self";
    const present = TABS.filter(t => rankings.some(r => t.sections.includes(sectionOf(r.kind))));
    if (!present.length) {
        message(self ? `<p>You haven't saved any rankings yet.</p>` : `<p>@${esc(profile.username)} hasn't saved any rankings yet.</p>`);
        return;
    }
    if (!present.some(t => t.id === openTabId)) openTabId = present[0].id;
    const tab = present.find(t => t.id === openTabId);
    // Each artist's rankings make one card (groupArtists), as on the saved rankings page.
    const inTab = groupArtists(rankings.filter(r => tab.sections.includes(sectionOf(r.kind))));
    const entryIds = e => (e.group ? e.rankings.map(r => r.id) : [e.id]);

    // Their public folders for this tab (a folder belongs to one kind of ranking).
    const folders = publicFolders.folders.filter(f => f.section == null || tab.sections.includes(f.section)
        || (f.section === "artist_albums" && tab.sections.includes("artist")));
    const inFolder = id => inTab.filter(e => entryIds(e).some(rid => publicFolders.items.some(i => i.folder_id === id && i.ranking_id === rid)));
    if (openFolderId !== "all" && !folders.some(f => f.id === openFolderId)) openFolderId = "all";
    const shown = sorted(openFolderId === "all" ? inTab : inFolder(openFolderId));
    const chip = (id, label, count) => `<button type="button" class="folder-chip${openFolderId === id ? " active" : ""}" data-folder="${esc(id)}" aria-pressed="${openFolderId === id}">
        <span class="folder-chip-name">${esc(label)}</span><span class="folder-chip-count">${count}</span></button>`;

    const pinned = pinnedEntries();
    bodyEl.innerHTML = `
        ${pinned.length || (self && pinsAvailable()) ? `<section class="profile-pinned">
            <h2 class="social-heading">Pinned favourites</h2>
            ${pinned.length ? `<div class="saved-grid pinned-grid" id="pinned-grid"></div>`
                : `<p class="tab-empty">Pin up to ${PIN_LIMIT} favourite albums or artists with the pin on their cards below, so your friends see them first.</p>`}
        </section>` : ""}
        <div class="type-tabs profile-tabs" role="group" aria-label="Kind of ranking">
            ${present.map(t => `<button type="button" class="type-tab${t === tab ? " active" : ""}" data-tab="${t.id}" aria-pressed="${t === tab}">
                ${esc(t.label)}<span class="type-tab-count">${groupArtists(rankings.filter(r => t.sections.includes(sectionOf(r.kind)))).length}</span></button>`).join("")}
        </div>
        <div class="profile-tools">
            <div class="sort-toggle" role="group" aria-label="Sort rankings">
                <button type="button" data-sort="recent" class="${sortBy === "recent" ? "active" : ""}" aria-pressed="${sortBy === "recent"}">Most recent</button>
                <button type="button" data-sort="rating" class="${sortBy === "rating" ? "active" : ""}" aria-pressed="${sortBy === "rating"}">Highest stars</button>
            </div>
        </div>
        ${folders.length ? `<div class="folder-bar profile-folders" aria-label="${self ? "Your public folders" : "Their folders"}">
            ${chip("all", "All", inTab.length)}${folders.map(f => chip(f.id, f.name, inFolder(f.id).length)).join("")}
        </div>` : ""}
        ${shown.length ? `<div class="saved-grid" id="profile-grid"></div>` : `<p class="tab-empty">Nothing in this folder yet.</p>`}`;
    const grid = bodyEl.querySelector("#profile-grid");
    shown.forEach(r => grid?.appendChild(card(r, self)));
    const pinnedGrid = bodyEl.querySelector("#pinned-grid");
    pinned.forEach(r => pinnedGrid?.appendChild(card(r, self)));
}

// Pinned albums / artists (and custom rankings), in the order they were pinned.
function pinnedEntries() {
    return groupArtists(rankings).filter(e => e.pinned_at)
        .sort((a, b) => String(a.pinned_at).localeCompare(String(b.pinned_at)));
}

const PIN_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3l5 5-3 1-3.5 3.5.5 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 .5L15 6z"/></svg>`;

// A card, with a pin button on your own profile. (The button sits beside the link,
// not inside it, so pressing it doesn't open the ranking.)
// Pins need the pinned-favourites migration (rows then carry pinned_at, even if null).
const pinsAvailable = () => rankings.some(r => "pinned_at" in r);

function card(entry, self) {
    const link = rankingCard(entry, { averages, friend: !self });
    if (!self || !pinsAvailable()) return link;
    const wrap = document.createElement("div");
    wrap.className = "pin-wrap";
    const on = Boolean(entry.pinned_at);
    wrap.innerHTML = `<button type="button" class="pin-btn${on ? " on" : ""}" data-pin="${esc(entry.id)}" aria-pressed="${on}" title="${on ? "Unpin from your profile" : "Pin to your profile"}" aria-label="${on ? "Unpin" : "Pin"} ${esc(entry.title)}">${PIN_ICON}</button>`;
    wrap.prepend(link);
    return wrap;
}

// Pin / unpin. An artist's card pins their newest ranking and unpins any of them.
async function togglePin(entryId, btn) {
    const entry = groupArtists(rankings).find(e => e.id === entryId);
    if (!entry) return;
    const members = entry.group ? entry.rankings : [entry];
    const pinning = !entry.pinned_at;
    if (pinning && pinnedEntries().length >= PIN_LIMIT) {
        alert(`You can pin up to ${PIN_LIMIT} favourites. Unpin one first.`);
        return;
    }
    btn.disabled = true;
    try {
        const now = new Date().toISOString();
        if (pinning) {
            await setPinned(members[0].id, true);
            members[0].pinned_at = now;
        } else {
            for (const r of members.filter(m => m.pinned_at)) { await setPinned(r.id, false); r.pinned_at = null; }
        }
        renderRankings();
    } catch (err) {
        console.error(err);
        btn.disabled = false;
        alert("That couldn't be saved just now. Please try again.");
    }
}

bodyEl.addEventListener("click", e => {
    const pinBtn = e.target.closest(".pin-btn[data-pin]");
    if (pinBtn) { togglePin(pinBtn.dataset.pin, pinBtn); return; }
    const tabBtn = e.target.closest(".type-tab[data-tab]");
    if (tabBtn && tabBtn.dataset.tab !== openTabId) {
        openTabId = tabBtn.dataset.tab;
        openFolderId = "all";
        renderRankings();
        return;
    }
    const sortBtn = e.target.closest(".sort-toggle [data-sort]");
    if (sortBtn && sortBtn.dataset.sort !== sortBy) {
        sortBy = sortBtn.dataset.sort;
        try { localStorage.setItem(SORT_KEY, sortBy); } catch {}
        renderRankings();
        return;
    }
    const folderBtn = e.target.closest(".folder-chip[data-folder]");
    if (folderBtn && folderBtn.dataset.folder !== openFolderId) {
        openFolderId = folderBtn.dataset.folder;
        renderRankings();
    }
});

async function showProfile() {
    renderHead();
    const rel = relationTo(profile.user_id, friendsData);
    if (rel.status !== "friends" && rel.status !== "self") {
        message(rel.status === "incoming"
            ? `<p>@${esc(profile.username)} wants to be friends. Accept to see each other's rankings.</p>`
            : `<p>Rankings are shared between friends. ${rel.status === "outgoing" ? "Once" : `Add @${esc(profile.username)} and once`} they accept, you'll see each other's rankings here and in your feed.</p>`);
        return;
    }
    bodyEl.innerHTML = `<p class="tab-loading">Loading rankings…</p>`;
    [rankings, publicFolders] = await Promise.all([
        rankingsOf(profile.user_id),
        publicFoldersOf(profile.user_id).catch(err => { console.warn(err); return { folders: [], items: [] }; }),
    ]);
    renderRankings();
    if (rankings.some(r => r.kind === "artist" || r.kind === "artist_albums")) {
        averages = await artistAverages(rankings).catch(() => new Map());
        renderRankings();
    }
}

async function load(user) {
    const id = ++loadId;
    const username = (new URLSearchParams(window.location.search).get("u") || "").trim().replace(/^@/, "");
    if (!user) {
        headEl.innerHTML = "";
        message(`<p>Log in to see profiles and your friends' rankings.</p><p><a href="${esc(loginUrl())}"><button type="button">Log in</button></a></p>`);
        return;
    }
    if (!username) { headEl.innerHTML = ""; message(`<p>No profile chosen. <a class="social-link" href="social.html?tab=find">Find people &#8250;</a></p>`); return; }
    try {
        const [found, friends] = await Promise.all([profileByUsername(username), loadFriends()]);
        if (id !== loadId) return;
        if (!found) {
            headEl.innerHTML = "";
            message(`<p>No one has the username @${esc(username)}.</p><p><a class="social-link" href="social.html?tab=find">Find people &#8250;</a></p>`);
            return;
        }
        profile = found;
        friendsData = friends;
        await showProfile();
    } catch (err) {
        if (id !== loadId) return;
        console.error(err);
        headEl.innerHTML = "";
        message(`<p>This profile couldn't be loaded just now.</p>`);
    }
}

let currentUser = null;
onUserChange(user => { currentUser = user; load(user); });
window.addEventListener("pageshow", e => { if (e.persisted && currentUser) load(currentUser); });
