// rank-view.js — the read-only "finished list" view of a saved ranking, shared by
// rank.html and rank-general.html. A saved ranking opens in this view; the page's
// Edit button switches to the two-column workspace (#rank-edit) and its Done button
// switches back. Under a saved ranking the view also has Add to folder and Delete.
import { esc } from "./auth.js";
import { getUser } from "./supabase.js";
import { deleteRanking, sectionOf, listRankings, rankingUrl } from "./saved-rankings.js";
import { openFoldersDialog, openModal } from "./folder-dialog.js";
import { getMyUsername } from "./profile.js";
import { myPostsOf, shareRanking, rankingOwner, rankingsOf, friendsRankingsOf, CAPTION_MAX } from "./social-data.js";
import { starsHtml, formatRating } from "./star-rating.js";
import { setupCompare } from "./rank-compare.js";
import { avatarHtml } from "./social-ui.js";

const viewEl = document.getElementById("rank-view");
const editEl = document.getElementById("rank-edit");
const titleEl = document.getElementById("rank-view-title");
const metaEl = document.getElementById("rank-view-meta");
const listEl = document.getElementById("rank-view-list");

const FOLDER_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h3.76a2 2 0 0 1 1.42.59L12.1 6H18.5A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>`;
const SHARE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16a3 3 0 0 0-2.4 1.2l-6.7-3.4a3 3 0 0 0 0-1.6l6.7-3.4A3 3 0 1 0 15 7c0 .3 0 .5.1.8L8.4 11.2a3 3 0 1 0 0 4.6l6.7 3.4A3 3 0 1 0 18 16z"/></svg>`;
const TRASH_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z"/></svg>`;

// ── Add to folder / Delete, for a ranking saved to the signed-in user's account ──
let savedRanking = null;    // { id, kind, title } or null
let manageCheck = 0;
const manageEl = document.createElement("div");
manageEl.className = "rank-view-manage";
manageEl.hidden = true;
manageEl.innerHTML = `
    <button type="button" class="rank-share-btn">${SHARE_ICON}Share to feed</button>
    <button type="button" class="rank-folder-btn">${FOLDER_ICON}Add to folder</button>
    <button type="button" class="rank-delete-btn danger">${TRASH_ICON}Delete ranking</button>`;
viewEl?.appendChild(manageEl);

// Pages call this whenever the saved ranking behind the view changes (null: none).
// The buttons only show once the user is known to be signed in; a saved id that isn't
// theirs is cleared by the Save button's check (initSaveButton), which calls this again.
export async function setSavedRanking(ranking) {
    savedRanking = ranking?.id ? ranking : null;
    const check = ++manageCheck;
    if (!savedRanking) { manageEl.hidden = true; friendsBtn.hidden = true; return; }
    const user = await getUser().catch(() => null);
    if (check !== manageCheck) return;
    manageEl.hidden = !user;
    if (user) refreshFriendsButton(savedRanking);
}

// ── See friends' rankings ──────────────────────────────────────────────
// On your own saved ranking: when friends have ranked the same album / artist (any
// edition), a button lists them; choosing one opens theirs in compare mode.
const PEOPLE_ICON = `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="7" cy="6.5" r="3.2"/><circle cx="14.2" cy="7.5" r="2.6"/><path d="M1 17c0-3.3 2.7-5.6 6-5.6s6 2.3 6 5.6z"/><path d="M13.6 11.6c3 0 5.4 2 5.4 5.1h-4.6c0-2-.3-3.6-.8-5.1z"/></svg>`;
const friendsBtn = document.createElement("button");
friendsBtn.type = "button";
friendsBtn.className = "secondary-btn rank-friends-btn";
friendsBtn.hidden = true;
viewEl?.querySelector(".rank-view-actions")?.appendChild(friendsBtn);
let friendsFor = null;      // which ranking the list below is for
let friendsList = [];

async function refreshFriendsButton(ranking) {
    const key = `${ranking.id}|${ranking.kind}`;
    if (friendsFor === key) return;
    friendsFor = key;
    friendsBtn.hidden = true;
    const found = await friendsRankingsOf(ranking).catch(() => []);
    if (friendsFor !== key) return;
    friendsList = found;
    friendsBtn.hidden = !found.length;
    friendsBtn.innerHTML = `${PEOPLE_ICON}See friends' rankings <span class="rank-friends-count">${found.length}</span>`;
}

friendsBtn.addEventListener("click", () => {
    const rows = friendsList.map(({ ranking: r, username }) => {
        const stars = r.kind === "album" && r.rating != null
            ? `<span class="friend-pick-stars">${starsHtml(Number(r.rating), { size: 13 })}<span>${formatRating(Number(r.rating))}</span></span>`
            : "";
        const count = r.item_ids?.length || 0;
        return `<a class="friend-pick" href="${esc(rankingUrl(r, { friend: true }))}&compare=1">
            ${avatarHtml(username, 38)}
            <span class="friend-pick-text">
                <span class="friend-pick-name">@${esc(username)}</span>
                <span class="friend-pick-sub">${esc(r.title)}${count ? ` · ${count} ranked` : ""}</span>
                ${stars}
            </span>
            <span class="friend-pick-go">Compare &#8250;</span>
        </a>`;
    }).join("");
    openModal(`
        <h2>Friends' rankings</h2>
        <p class="library-modal-sub">${esc(savedRanking?.title || "")}</p>
        <div class="friend-picks">${rows}</div>`);
});

// Share to feed: an optional caption, then a post your friends see in their feed.
manageEl.querySelector(".rank-share-btn").addEventListener("click", () => {
    if (savedRanking) openShareDialog(savedRanking);
});

async function openShareDialog(ranking) {
    const { modal, close } = openModal(`
        <h2>Share to your feed</h2>
        <p class="library-modal-sub">${esc(ranking.title)}</p>
        <div class="share-body"><p class="library-modal-empty">Loading…</p></div>`);
    const body = modal.querySelector(".share-body");
    let username, posts;
    try {
        [username, posts] = await Promise.all([getMyUsername(), myPostsOf(ranking.id)]);
    } catch (err) {
        console.error(err);
        body.innerHTML = `<p class="library-modal-empty">Sharing isn't available just now.</p>`;
        return;
    }
    if (posts === null) { body.innerHTML = `<p class="library-modal-empty">Sharing isn't switched on yet.</p>`; return; }
    if (!username) {
        body.innerHTML = `<p class="library-modal-empty">Choose a username first, so your friends know who shared it.</p>
            <a href="account.html#username-form"><button type="button">Choose a username</button></a>`;
        return;
    }
    const last = posts[0];
    body.innerHTML = `
        ${last ? `<p class="share-note">You last shared this on ${esc(new Date(last.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }))}. Sharing again posts it to the top of the feed.</p>` : ""}
        <form class="auth-form share-form" novalidate>
            <label class="auth-field">
                <span>Say something about it (optional)</span>
                <textarea name="caption" rows="3" maxlength="${CAPTION_MAX}" placeholder="e.g. Finally ranked this one!"></textarea>
            </label>
            <p class="share-count"><span>0</span> / ${CAPTION_MAX}</p>
            <p class="username-status error" aria-live="polite"></p>
            <button type="submit">Share</button>
        </form>`;
    const form = body.querySelector("form");
    const counter = body.querySelector(".share-count span");
    form.elements.caption.addEventListener("input", () => { counter.textContent = form.elements.caption.value.length; });
    form.addEventListener("submit", async e => {
        e.preventDefault();
        const btn = form.querySelector("button");
        btn.disabled = true;
        try {
            await shareRanking(ranking.id, form.elements.caption.value);
            body.innerHTML = `<p class="share-done">Shared to your feed &#10003;</p>
                <p><a class="social-link" href="social.html">See the feed &#8250;</a></p>`;
        } catch (err) {
            console.error(err);
            btn.disabled = false;
            form.querySelector(".username-status").textContent = "That couldn't be shared just now. Please try again.";
        }
    });
    form.elements.caption.focus();
    return close;
}

// ── A friend's ranking (from=<id>): read only ─────────────────────────
// Hides Edit and the owner's buttons, and says whose it is, with a link to start your
// own ranking of the same album / artist (freshHref).
let friendCheck = 0;
export async function setFriendRanking(rankingId, freshHref) {
    const check = ++friendCheck;
    document.getElementById("rank-edit-btn")?.setAttribute("hidden", "");
    manageEl.hidden = true;
    savedRanking = null;
    let byline = viewEl.querySelector(".rank-view-byline");
    if (!byline) {
        byline = document.createElement("p");
        byline.className = "rank-view-byline";
        viewEl.prepend(byline);
    }
    const actions = viewEl.querySelector(".rank-view-actions");
    if (actions && !actions.querySelector(".rank-own-btn")) {
        const own = document.createElement("a");
        own.className = "rank-own-btn";
        own.href = freshHref;
        own.innerHTML = `<button type="button">Rank it yourself</button>`;
        actions.prepend(own);
    }
    byline.textContent = "A friend's ranking";
    const owner = await rankingOwner(rankingId).catch(() => null);
    if (check !== friendCheck) return;
    if (owner?.username) {
        byline.innerHTML = `Ranked by <a href="profile.html?u=${encodeURIComponent(owner.username)}">@${esc(owner.username)}</a>`;
        // You've ranked the same thing: offer to compare the two.
        setupCompare(viewEl, owner.ranking, owner.username);
    } else if (!owner) {
        byline.textContent = "Shared ranking";
    }
}

manageEl.querySelector(".rank-folder-btn").addEventListener("click", () => {
    if (savedRanking) openFoldersDialog(savedRanking);
});

manageEl.querySelector(".rank-delete-btn").addEventListener("click", async e => {
    const r = savedRanking;
    if (!r || !confirm(`Delete "${r.title}"? This can't be undone.`)) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
        await deleteRanking(r.id);
        window.location.href = `rankings.html?type=${encodeURIComponent(sectionOf(r.kind))}#saved-rankings`;
    } catch (err) {
        console.error(err);
        btn.disabled = false;
        alert("That ranking couldn't be deleted just now. Please try again.");
    }
});

// ── An artist's two lists: Top tracks / Albums & EPs ─────────────────
// On an artist's finished list, a switch moves between their top tracks ranking and
// their albums & EPs ranking (the Artists tab shows one card per artist). Yours: the
// other list opens your saved one, or a new one if you haven't made it. A friend's
// (friendRankingId): their saved one, or a disabled "Not ranked" button.
let listsCheck = 0;
export async function showArtistLists({ artistId, current, friendRankingId = null }) {
    const check = ++listsCheck;
    let el = viewEl?.querySelector(".rank-view-lists");
    if (!viewEl) return;
    if (!el) {
        el = document.createElement("div");
        el.className = "rank-view-lists rank-mode-toggle";
        el.setAttribute("role", "group");
        el.setAttribute("aria-label", "Which list");
        titleEl.before(el);
    }
    const draw = links => {
        el.innerHTML = [["tracks", "Top tracks"], ["albums", "Albums & EPs"]].map(([id, label]) => {
            if (id === current) return `<span class="tab-btn active" aria-current="page">${label}</span>`;
            const href = links[id];
            return href ? `<a class="tab-btn" href="${esc(href)}">${label}</a>`
                : `<span class="tab-btn disabled" title="Not ranked yet">${label}<small> · not ranked</small></span>`;
        }).join("");
    };
    draw({});   // straight away, then with links once the rankings are known
    let rankings = [];
    try {
        if (friendRankingId) {
            const owner = await rankingOwner(friendRankingId);
            rankings = owner ? await rankingsOf(owner.ranking.user_id) : [];
        } else {
            rankings = (await listRankings()) || [];
        }
    } catch (err) { console.warn(err); }
    if (check !== listsCheck) return;
    const newest = kind => rankings.find(r => r.kind === kind && r.source_id === artistId);
    const link = (kind, list) => {
        const r = newest(kind);
        if (r) return rankingUrl(r, { friend: Boolean(friendRankingId) });
        return friendRankingId ? null : `rank.html?type=artist&id=${encodeURIComponent(artistId)}${list === "albums" ? "&list=albums" : ""}`;
    };
    draw({ tracks: link("artist", "tracks"), albums: link("artist_albums", "albums") });
}

// Shows the view (true) or the workspace (false).
export function setViewMode(viewing) {
    if (viewEl) viewEl.hidden = !viewing;
    if (editEl) editEl.hidden = viewing;
}

// items: [{ name, subtitle, image, round, href?, badgeHtml? }]
// With href the whole row is a link (e.g. an artist's album → its own album ranking).
// badgeHtml is trusted markup built by the caller (stars, a status label).
export function renderRankView({ title, meta = "", items = [], emptyText = "Nothing ranked yet." }) {
    if (!viewEl) return;
    titleEl.textContent = title;
    metaEl.textContent = meta;
    metaEl.hidden = !meta;
    if (!items.length) {
        listEl.innerHTML = `<li class="rank-view-empty">${esc(emptyText)}</li>`;
        return;
    }
    listEl.innerHTML = items.map((item, i) => {
        const inner = `
            <span class="rank-view-num">${i + 1}</span>
            ${item.image
                ? `<img class="rank-view-img${item.round ? " round" : ""}" src="${esc(item.image)}" alt="">`
                : `<div class="rank-view-img rank-result-placeholder${item.round ? " round" : ""}"></div>`}
            <div class="rank-view-text">
                <span class="rank-view-name">${esc(item.name)}</span>
                ${item.subtitle ? `<span class="rank-view-sub">${esc(item.subtitle)}</span>` : ""}
            </div>
            ${item.badgeHtml ? `<span class="rank-view-badge">${item.badgeHtml}</span>` : ""}`;
        const classes = `rank-view-item${i < 3 ? ` podium podium-${i + 1}` : ""}${item.href ? " has-link" : ""}`;
        return item.href
            ? `<li class="${classes}"><a class="rank-view-link" href="${esc(item.href)}">${inner}</a></li>`
            : `<li class="${classes}">${inner}</li>`;
    }).join("");
}
