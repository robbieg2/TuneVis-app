// social-ui.js — small pieces shared by the social page (social.js) and profiles
// (profile-page.js): avatars, "2h ago" times, friend buttons and feed posts.
import { esc } from "./auth.js";
import { rankingUrl, KIND_LABELS } from "./saved-rankings.js";
import { starsHtml, formatRating } from "./star-rating.js";
import { sendFriendRequest, acceptFriendRequest, removeFriendship } from "./social-data.js";

export const profileUrl = username => `profile.html?u=${encodeURIComponent(username)}`;

// A round avatar with the username's first letter, coloured from the name.
export function avatarHtml(username, size = 40) {
    const name = String(username || "?");
    let h = 0;
    for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px;--avatar-hue:${h}" aria-hidden="true">${esc(name.charAt(0).toUpperCase())}</span>`;
}

export function timeAgo(iso) {
    const then = new Date(iso).getTime();
    const s = Math.max(0, (Date.now() - then) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// The buttons for where you stand with someone (relationTo() in social-data.js).
export function relationButtonsHtml(rel) {
    switch (rel.status) {
        case "friends":  return `<span class="relation-label">Friends</span><button type="button" class="person-btn subtle" data-action="unfriend">Remove</button>`;
        case "incoming": return `<button type="button" class="person-btn" data-action="accept">Accept</button><button type="button" class="person-btn subtle" data-action="decline">Decline</button>`;
        case "outgoing": return `<span class="relation-label">Request sent</span><button type="button" class="person-btn subtle" data-action="cancel">Cancel</button>`;
        case "self":     return `<span class="relation-label">You</span>`;
        default:         return `<button type="button" class="person-btn" data-action="add">Add friend</button>`;
    }
}

// Runs a relation button's action. Resolves to the new status, or null if cancelled.
export async function runRelationAction(action, { userId, username, rel }) {
    if (action === "add") return (await sendFriendRequest(userId)).status;
    if (action === "accept") { await acceptFriendRequest(rel.id); return "friends"; }
    if (action === "unfriend" && !confirm(`Remove @${username} as a friend? You'll stop seeing each other's rankings.`)) return null;
    if (["decline", "cancel", "unfriend"].includes(action)) { await removeFriendship(rel.id); return "none"; }
    return null;
}

// A feed post: who shared it and when, their caption, then the ranking (cover, name,
// stars and its top three) linking to the ranking itself.
export function postHtml(post) {
    const r = post.ranking;
    const round = ["artist", "artist_albums", "fav_artists"].includes(r.kind) ? " round" : "";
    const href = rankingUrl(r, { friend: !post.mine });
    const top = (r.items || []).slice(0, 3);
    const more = (r.item_ids?.length || 0) - top.length;
    const stars = r.kind === "album" && r.rating != null
        ? `<span class="saved-card-stars">${starsHtml(Number(r.rating), { size: 14 })}<span>${formatRating(Number(r.rating))}</span></span>`
        : "";
    return `
        <article class="post" data-post-id="${esc(post.id)}">
            <div class="post-head">
                <a class="post-author" href="${esc(profileUrl(post.username))}">
                    ${avatarHtml(post.username, 36)}
                    <span class="post-author-text">
                        <span class="post-username">${post.mine ? "You" : `@${esc(post.username)}`}</span>
                        <span class="post-time">shared a ranking · ${esc(timeAgo(post.created_at))}</span>
                    </span>
                </a>
                ${post.mine ? `<button type="button" class="post-remove" data-action="remove-post" aria-label="Remove from feed" title="Remove from feed">&#10005;</button>` : ""}
            </div>
            ${post.caption ? `<p class="post-caption">${esc(post.caption)}</p>` : ""}
            <a class="post-ranking" href="${esc(href)}">
                <span class="post-cover saved-card-cover${round}">
                    ${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : `<span class="saved-card-placeholder" aria-hidden="true">${esc((r.title || "?").charAt(0).toUpperCase())}</span>`}
                </span>
                <span class="post-ranking-text">
                    <span class="post-ranking-title">${esc(r.title)}</span>
                    <span class="saved-card-sub">${esc([KIND_LABELS[r.kind], r.source_name && r.source_name !== r.title ? r.source_name : null].filter(Boolean).join(" · "))}</span>
                    ${stars}
                    ${top.length ? `<ol class="post-top">${top.map(i => `<li>${esc(i.name)}</li>`).join("")}</ol>` : ""}
                    ${more > 0 ? `<span class="post-more">+ ${more} more</span>` : ""}
                </span>
            </a>
            ${post.likes ? postSocialHtml(post) : ""}
        </article>`;
}

// ── Likes and comments under a post ───────────────────────────────────
const HEART = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.4C1.5 7.8 3.6 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.4 0 5.5 3.3 4.3 6.6-1.8 4.8-9.3 9.4-9.3 9.4z"/></svg>`;
const BUBBLE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A2.5 2.5 0 0 1 3 13.5z"/></svg>`;
const SHOWN_COMMENTS = 2;

function likedByHtml(likes) {
    if (!likes.length) return "";
    const names = likes.slice(0, 2).map(l => `<a href="${esc(profileUrl(l.username))}">@${esc(l.username)}</a>`);
    const others = likes.length - names.length;
    return `<p class="post-liked-by">Liked by ${names.join(others ? ", " : " and ")}${others ? ` and ${others} other${others === 1 ? "" : "s"}` : ""}</p>`;
}

// post.expanded: every comment and the comment box are showing.
export function postSocialHtml(post) {
    const comments = post.comments || [];
    const hidden = post.expanded ? 0 : Math.max(0, comments.length - SHOWN_COMMENTS);
    const shown = comments.slice(hidden);
    return `
        <div class="post-actions">
            <button type="button" class="post-act like${post.liked ? " on" : ""}" data-action="like" aria-pressed="${post.liked}" aria-label="${post.liked ? "Unlike" : "Like"}">
                ${HEART}<span>${post.likes.length || ""}</span>
            </button>
            <button type="button" class="post-act" data-action="comment" aria-expanded="${Boolean(post.expanded)}" aria-label="Comments">
                ${BUBBLE}<span>${comments.length || ""}</span>
            </button>
        </div>
        ${likedByHtml(post.likes)}
        ${hidden ? `<button type="button" class="post-more-comments" data-action="comment">View all ${comments.length} comments</button>` : ""}
        ${shown.length ? `<ul class="post-comments">${shown.map(c => `
            <li class="post-comment" data-comment-id="${esc(c.id)}">
                <a class="post-comment-avatar" href="${esc(profileUrl(c.username))}">${avatarHtml(c.username, 28)}</a>
                <div class="post-comment-body">
                    <p><a class="post-comment-name" href="${esc(profileUrl(c.username))}">@${esc(c.username)}</a> ${esc(c.body)}</p>
                    <span class="post-comment-meta">${esc(timeAgo(c.created_at))}${c.removable ? ` · <button type="button" class="post-comment-delete" data-action="delete-comment">Delete</button>` : ""}</span>
                </div>
            </li>`).join("")}</ul>` : ""}
        ${post.expanded ? `
            <form class="post-comment-form" novalidate>
                <input type="text" name="body" maxlength="500" autocomplete="off" enterkeyhint="send" placeholder="Add a comment…" aria-label="Add a comment">
                <button type="submit" class="secondary-btn">Post</button>
            </form>` : ""}`;
}
