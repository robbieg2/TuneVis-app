// social.js — social.html: the feed of rankings shared by you and your friends, your
// friends and requests, and finding people by username. Needs an account with a
// username (chosen on the account page) and the social migration in the database.
import { esc } from "./auth.js";
import { onUserChange, loginUrl, accountsConfigured } from "./supabase.js";
import { getMyUsername } from "./profile.js";
import { loadFriends, loadFeed, searchProfiles, relationTo, deletePost, likePost, unlikePost, addComment, deleteComment } from "./social-data.js";
import { avatarHtml, timeAgo, profileUrl, relationButtonsHtml, runRelationAction, postHtml } from "./social-ui.js";

const gateEl = document.getElementById("social-gate");
const appEl = document.getElementById("social-app");
const meEl = document.getElementById("social-me");
const feedEl = document.getElementById("feed-list");
const requestsEl = document.getElementById("friends-requests");
const friendsEl = document.getElementById("friends-list");
const sentEl = document.getElementById("friends-sent");
const badgeEl = document.getElementById("friends-badge");
const searchInput = document.getElementById("people-search-input");
const resultsEl = document.getElementById("people-results");

const TABS = ["feed", "friends", "find"];
let friendsData = null;
let myUsername = null;
let loadId = 0;

// ── Gate: signed out / no username / not set up ───────────────────────
function showGate(html) {
    gateEl.hidden = false;
    appEl.hidden = true;
    gateEl.innerHTML = `<div class="social-gate-card">${html}</div>`;
}

// ── Tabs (?tab=feed|friends|find) ─────────────────────────────────────
function openTab(tab, { push = true } = {}) {
    if (!TABS.includes(tab)) tab = "feed";
    for (const t of TABS) {
        const on = t === tab;
        document.getElementById(`tab-btn-${t}`).classList.toggle("active", on);
        document.getElementById(`tab-btn-${t}`).setAttribute("aria-selected", String(on));
        document.getElementById(`tab-${t}`).hidden = !on;
    }
    if (push) {
        const url = new URL(window.location.href);
        if (tab === "feed") url.searchParams.delete("tab"); else url.searchParams.set("tab", tab);
        history.replaceState(null, "", url);
    }
    if (tab === "find") searchInput.focus({ preventScroll: true });
}

document.querySelector(".social-tabs").addEventListener("click", e => {
    const btn = e.target.closest("[data-tab]");
    if (btn) openTab(btn.dataset.tab);
});

// ── Feed ───────────────────────────────────────────────────────────────
async function renderFeed() {
    feedEl.innerHTML = `<p class="tab-loading">Loading the feed…</p>`;
    try {
        const { posts } = await loadFeed();
        if (!posts.length) {
            feedEl.innerHTML = `<div class="social-empty">
                <p><strong>Nothing here yet.</strong></p>
                <p>Open one of your saved rankings and press <em>Share to feed</em> to post it here. ${friendsData?.friends.length ? "" : "Add some friends to see theirs too."}</p>
                <p><a class="social-link" href="rankings.html#saved-rankings">Your rankings &#8250;</a>${friendsData?.friends.length ? "" : ` &middot; <a class="social-link" href="?tab=find" data-open-tab="find">Add friends &#8250;</a>`}</p>
            </div>`;
            return;
        }
        feedPosts = posts;
        feedEl.innerHTML = posts.map(postHtml).join("");
    } catch (err) {
        console.error(err);
        feedEl.innerHTML = `<p class="tab-empty">The feed couldn't be loaded just now.</p>`;
    }
}

// ── Likes and comments ─────────────────────────────────────────────────
let feedPosts = [];
const postFor = el => feedPosts.find(p => p.id === el.closest(".post")?.dataset.postId);

// Redraws one post in place (after a like or a comment), keeping the comment box focused.
function redrawPost(post, { focusComment = false } = {}) {
    const el = feedEl.querySelector(`.post[data-post-id="${CSS.escape(post.id)}"]`);
    if (!el) return;
    el.outerHTML = postHtml(post);
    if (focusComment) feedEl.querySelector(`.post[data-post-id="${CSS.escape(post.id)}"] .post-comment-form input`)?.focus();
}

async function toggleLike(post) {
    const me = friendsData.me.id;
    const wasLiked = post.liked;
    // Show it straight away; put it back if saving fails.
    post.liked = !wasLiked;
    post.likes = wasLiked ? post.likes.filter(l => l.user_id !== me) : [...post.likes, { user_id: me, username: myUsername }];
    redrawPost(post);
    try {
        if (wasLiked) await unlikePost(post.id); else await likePost(post.id);
    } catch (err) {
        console.error(err);
        post.liked = wasLiked;
        post.likes = wasLiked ? [...post.likes, { user_id: me, username: myUsername }] : post.likes.filter(l => l.user_id !== me);
        redrawPost(post);
        alert("That like couldn't be saved just now. Please try again.");
    }
}

feedEl.addEventListener("submit", async e => {
    const form = e.target.closest(".post-comment-form");
    if (!form) return;
    e.preventDefault();
    const post = postFor(form);
    const input = form.elements.body;
    if (!post || !input.value.trim()) return;
    const btn = form.querySelector("button");
    btn.disabled = input.disabled = true;
    try {
        const saved = await addComment(post.id, input.value);
        post.comments = [...post.comments, { ...saved, user_id: friendsData.me.id, username: myUsername, mine: true, removable: true }];
        redrawPost(post, { focusComment: true });
    } catch (err) {
        console.error(err);
        btn.disabled = input.disabled = false;
        alert("That comment couldn't be posted just now. Please try again.");
    }
});

feedEl.addEventListener("click", async e => {
    const tabLink = e.target.closest("[data-open-tab]");
    if (tabLink) { e.preventDefault(); openTab(tabLink.dataset.openTab); return; }
    const act = e.target.closest('[data-action="like"], [data-action="comment"], [data-action="delete-comment"]');
    if (act) {
        const post = postFor(act);
        if (!post) return;
        if (act.dataset.action === "like") { toggleLike(post); return; }
        if (act.dataset.action === "comment") {
            post.expanded = !post.expanded || act.classList.contains("post-more-comments");
            redrawPost(post, { focusComment: post.expanded });
            return;
        }
        const row = act.closest(".post-comment");
        if (!confirm("Delete this comment?")) return;
        act.disabled = true;
        try {
            await deleteComment(row.dataset.commentId);
            post.comments = post.comments.filter(c => c.id !== row.dataset.commentId);
            redrawPost(post);
        } catch (err) {
            console.error(err);
            act.disabled = false;
            alert("That comment couldn't be deleted just now. Please try again.");
        }
        return;
    }
    const btn = e.target.closest('[data-action="remove-post"]');
    if (!btn) return;
    if (!confirm("Remove this post from the feed? The ranking itself stays saved.")) return;
    const post = btn.closest(".post");
    btn.disabled = true;
    try {
        await deletePost(post.dataset.postId);
        post.remove();
        if (!feedEl.querySelector(".post")) renderFeed();
    } catch (err) {
        console.error(err);
        btn.disabled = false;
        alert("That post couldn't be removed just now. Please try again.");
    }
});

// ── People rows (friends list, requests, search results) ──────────────
function personRow(person, rel, note = "") {
    return `
        <div class="person" data-user-id="${esc(person.user_id)}" data-username="${esc(person.username)}">
            <a class="person-link" href="${esc(profileUrl(person.username))}">
                ${avatarHtml(person.username, 40)}
                <span class="person-text">
                    <span class="person-name">@${esc(person.username)}</span>
                    ${note ? `<span class="person-note">${esc(note)}</span>` : ""}
                </span>
            </a>
            <span class="person-actions">${relationButtonsHtml(rel)}</span>
        </div>`;
}

function renderFriends() {
    const { friends, incoming, outgoing } = friendsData;
    badgeEl.hidden = !incoming.length;
    badgeEl.textContent = incoming.length ? String(incoming.length) : "";

    requestsEl.innerHTML = incoming.length ? `
        <h2 class="social-heading">Friend requests</h2>
        <div class="people-list">${incoming.map(p => personRow(p, { status: "incoming", id: p.id }, `Asked ${timeAgo(p.created_at)}`)).join("")}</div>` : "";

    friendsEl.innerHTML = friends.length
        ? friends.map(p => personRow(p, { status: "friends", id: p.id }, p.accepted_at ? `Friends since ${new Date(p.accepted_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })}` : "")).join("")
        : `<div class="social-empty"><p>No friends yet. <a class="social-link" href="?tab=find" data-open-tab="find">Find people by username &#8250;</a></p></div>`;

    sentEl.innerHTML = outgoing.length ? `
        <h2 class="social-heading">Requests you've sent</h2>
        <div class="people-list">${outgoing.map(p => personRow(p, { status: "outgoing", id: p.id }, `Sent ${timeAgo(p.created_at)}`)).join("")}</div>` : "";
}

// Accept / decline / cancel / remove / add, from any list on the page.
appEl.addEventListener("click", async e => {
    const tabLink = e.target.closest("[data-open-tab]");
    if (tabLink && !feedEl.contains(tabLink)) { e.preventDefault(); openTab(tabLink.dataset.openTab); return; }
    const btn = e.target.closest(".person-btn[data-action]");
    if (!btn) return;
    const row = btn.closest(".person");
    const userId = row.dataset.userId, username = row.dataset.username;
    const rel = relationTo(userId, friendsData);
    row.querySelectorAll("button").forEach(b => { b.disabled = true; });
    try {
        const status = await runRelationAction(btn.dataset.action, { userId, username, rel });
        if (status === null) { row.querySelectorAll("button").forEach(b => { b.disabled = false; }); return; }
        friendsData = await loadFriends();
        renderFriends();
        refreshSearchRows();
        if (btn.dataset.action === "accept" || btn.dataset.action === "unfriend") renderFeed();
    } catch (err) {
        console.error(err);
        row.querySelectorAll("button").forEach(b => { b.disabled = false; });
        alert("That didn't go through just now. Please try again.");
    }
});

// ── Finding people ─────────────────────────────────────────────────────
let searchTimer = null;
let searchId = 0;
let lastResults = [];

function renderResults(results, query) {
    lastResults = results;
    if (!query) { resultsEl.innerHTML = ""; return; }
    resultsEl.innerHTML = results.length
        ? results.map(p => personRow(p, relationTo(p.user_id, friendsData))).join("")
        : `<p class="tab-empty">No one's username starts with "${esc(query)}".</p>`;
}

function refreshSearchRows() {
    if (searchInput.value.trim().length >= 2) renderResults(lastResults, searchInput.value.trim());
}

searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const query = searchInput.value.trim().replace(/^@/, "");
    if (query.length < 2) { searchId++; renderResults([], ""); return; }
    searchTimer = setTimeout(async () => {
        const id = ++searchId;
        try {
            const results = await searchProfiles(query);
            if (id === searchId) renderResults(results, query);
        } catch (err) {
            console.error(err);
            if (id === searchId) resultsEl.innerHTML = `<p class="tab-empty">Search isn't working just now.</p>`;
        }
    }, 250);
});

// ── Loading ────────────────────────────────────────────────────────────
async function load(user) {
    const id = ++loadId;
    if (!accountsConfigured) { showGate(`<p>Accounts aren't available right now.</p>`); return; }
    if (!user) {
        showGate(`
            <h2>Rank together</h2>
            <p>Add friends, see their rankings and share yours to a feed.</p>
            <div class="social-gate-actions">
                <a href="${esc(loginUrl())}"><button type="button">Log in</button></a>
                <a href="signup.html"><button type="button" class="secondary-btn">Sign up</button></a>
            </div>`);
        return;
    }
    try {
        myUsername = await getMyUsername();
        if (id !== loadId) return;
        if (!myUsername) {
            showGate(`
                <h2>Choose a username first</h2>
                <p>Friends find you by your username, so you'll need one before using Social.</p>
                <div class="social-gate-actions"><a href="account.html#username-form"><button type="button">Choose a username</button></a></div>`);
            return;
        }
        friendsData = await loadFriends();
        if (id !== loadId) return;
        if (!friendsData.available) {
            showGate(`<p>Social isn't switched on yet. Please check back soon.</p>`);
            return;
        }
    } catch (err) {
        console.error(err);
        showGate(`<p>Social couldn't be loaded just now. Please try again.</p>`);
        return;
    }

    gateEl.hidden = true;
    appEl.hidden = false;
    meEl.innerHTML = `
        <a class="social-me-link" href="${esc(profileUrl(myUsername))}">
            ${avatarHtml(myUsername, 44)}
            <span><span class="social-me-name">@${esc(myUsername)}</span><span class="social-me-sub">Your profile &#8250;</span></span>
        </a>`;
    renderFriends();
    renderFeed();
    openTab(new URLSearchParams(window.location.search).get("tab") || (friendsData.incoming.length ? "friends" : "feed"), { push: false });
}

let currentUser = null;
onUserChange(user => { currentUser = user; load(user); });

// The search box starts empty whenever the page is shown (see CLAUDE.md), and coming
// Back reloads the lists (a request may have been answered meanwhile).
window.addEventListener("pageshow", e => {
    searchInput.value = "";
    resultsEl.innerHTML = "";
    if (e.persisted && currentUser) load(currentUser);
});
