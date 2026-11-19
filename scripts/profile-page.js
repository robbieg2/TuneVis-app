// profile-page.js — profile.html?u=<username>: someone's TuneVis profile. Friends (and
// you, on your own) see their saved rankings as cover cards in Albums / Artists /
// Custom tabs; anyone else sees the friend button only. Friends' rankings open
// read-only (rankingUrl(r, { friend: true })).
import { esc } from "./auth.js";
import { onUserChange, loginUrl } from "./supabase.js";
import { sectionOf } from "./saved-rankings.js";
import { artistAverages } from "./artist-ratings.js";
import { rankingCard } from "./ranking-cards.js";
import { profileByUsername, loadFriends, relationTo, rankingsOf } from "./social-data.js";
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
let loadId = 0;

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
    const shown = rankings.filter(r => tab.sections.includes(sectionOf(r.kind)));
    bodyEl.innerHTML = `
        <div class="type-tabs profile-tabs" role="group" aria-label="Kind of ranking">
            ${present.map(t => `<button type="button" class="type-tab${t === tab ? " active" : ""}" data-tab="${t.id}" aria-pressed="${t === tab}">
                ${esc(t.label)}<span class="type-tab-count">${rankings.filter(r => t.sections.includes(sectionOf(r.kind))).length}</span></button>`).join("")}
        </div>
        <div class="saved-grid" id="profile-grid"></div>`;
    const grid = bodyEl.querySelector("#profile-grid");
    shown.forEach(r => grid.appendChild(rankingCard(r, { averages, friend: !self })));
}

bodyEl.addEventListener("click", e => {
    const btn = e.target.closest(".type-tab[data-tab]");
    if (!btn || btn.dataset.tab === openTabId) return;
    openTabId = btn.dataset.tab;
    renderRankings();
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
    rankings = await rankingsOf(profile.user_id);
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
