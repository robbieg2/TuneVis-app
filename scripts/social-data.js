// social-data.js — friends, profiles and the shared feed (the "social" migration in
// supabase/schema.sql). Friendships need a username on both sides (public.profiles).
// Row-level security does the real checks: friends can read each other's rankings and
// posts, nobody can change anyone else's, and usernames are only found by search.
//
// Before the social migration has been run the tables don't exist; every loader then
// reports { available: false } so the pages can say so instead of failing.
import { getSupabase, getUser } from "./supabase.js";
import { sameSubject } from "./album-editions.js";

const RANKING_COLUMNS = "id, user_id, kind, source_id, source_name, genre, title, size, item_ids, items, image, updated_at, rating";
const CAPTION_MAX = 280;
export { CAPTION_MAX };

const isMissing = error => ["42P01", "PGRST205", "42883", "PGRST202"].includes(error?.code);

async function client() {
    const supabase = await getSupabase();
    const user = supabase ? await getUser() : null;
    return { supabase, user };
}

// Rankings, falling back to the columns that exist before the ratings migration.
async function selectRankings(build) {
    const { supabase } = await client();
    const missing = r => r.error?.code === "42703" || r.error?.code === "PGRST204";
    let result = await build(supabase.from("rankings").select(`${RANKING_COLUMNS}, pinned_at`));
    if (missing(result)) result = await build(supabase.from("rankings").select(RANKING_COLUMNS));
    if (missing(result)) result = await build(supabase.from("rankings").select(RANKING_COLUMNS.replace(", rating", "")));
    return result;
}

// { user_id → username } for these accounts (the ones you can see: friends, requests).
async function usernames(ids) {
    const unique = [...new Set(ids)].filter(Boolean);
    if (!unique.length) return new Map();
    const { supabase } = await client();
    const { data, error } = await supabase.from("profiles").select("user_id, username").in("user_id", unique);
    if (error) throw error;
    return new Map((data || []).map(p => [p.user_id, p.username]));
}

// ── People ─────────────────────────────────────────────────────────────
// Usernames starting with what was typed (2+ characters). [{ user_id, username }]
export async function searchProfiles(query) {
    const { supabase } = await client();
    const { data, error } = await supabase.rpc("search_profiles", { p_query: query });
    if (error) throw error;
    return data || [];
}

// { user_id, username } for an exact username (any case), or null.
export async function profileByUsername(username) {
    const { supabase } = await client();
    const { data, error } = await supabase.rpc("profile_by_username", { p_username: username });
    if (error) throw error;
    return data?.[0] || null;
}

// The signed-in user's requests and friends, each with the other person's username:
// { available, me, friends, incoming, outgoing } — each list of
// { id, user_id, username, created_at, accepted_at }.
export async function loadFriends() {
    const { supabase, user } = await client();
    const empty = { available: false, me: user, friends: [], incoming: [], outgoing: [] };
    if (!supabase || !user) return empty;
    const { data, error } = await supabase.from("friendships")
        .select("id, requester, addressee, status, created_at, accepted_at")
        .order("created_at", { ascending: false });
    if (isMissing(error)) return empty;
    if (error) throw error;
    const rows = data || [];
    const other = f => (f.requester === user.id ? f.addressee : f.requester);
    const names = await usernames(rows.map(other));
    const shape = f => ({ id: f.id, user_id: other(f), username: names.get(other(f)) || "unknown", created_at: f.created_at, accepted_at: f.accepted_at });
    const byName = (a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: "base" });
    return {
        available: true,
        me: user,
        friends: rows.filter(f => f.status === "accepted").map(shape).sort(byName),
        incoming: rows.filter(f => f.status === "pending" && f.addressee === user.id).map(shape),
        outgoing: rows.filter(f => f.status === "pending" && f.requester === user.id).map(shape),
    };
}

// Where you stand with someone: "self" | "friends" | "incoming" | "outgoing" | "none",
// plus the friendship row's id when there is one.
export function relationTo(userId, friendsData) {
    if (userId === friendsData.me?.id) return { status: "self" };
    for (const status of ["friends", "incoming", "outgoing"]) {
        const row = friendsData[status].find(f => f.user_id === userId);
        if (row) return { status, id: row.id };
    }
    return { status: "none" };
}

// Ask to be friends. If they've already asked you, this accepts theirs instead.
export async function sendFriendRequest(userId) {
    const { supabase } = await client();
    const { error } = await supabase.from("friendships").insert({ addressee: userId });
    if (!error) return { status: "outgoing" };
    if (error.code === "23505") {
        const data = await loadFriends();
        const rel = relationTo(userId, data);
        if (rel.status === "incoming") { await acceptFriendRequest(rel.id); return { status: "friends" }; }
        return { status: rel.status };
    }
    throw error;
}

export async function acceptFriendRequest(friendshipId) {
    const { supabase } = await client();
    const { data, error } = await supabase.from("friendships")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("id", friendshipId).select("id");
    if (error) throw error;
    if (!data?.length) throw new Error("That request isn't there any more.");
}

// Decline, cancel or unfriend: removes the row either way.
export async function removeFriendship(friendshipId) {
    const { supabase } = await client();
    const { error } = await supabase.from("friendships").delete().eq("id", friendshipId);
    if (error) throw error;
}

// ── Rankings ───────────────────────────────────────────────────────────
// Someone's saved rankings, newest first: yours, or a friend's (others see none).
export async function rankingsOf(userId) {
    const { data, error } = await selectRankings(q =>
        q.eq("user_id", userId).order("updated_at", { ascending: false }).limit(200));
    if (error) throw error;
    return data || [];
}

// Who owns a ranking and their username, if you can see it: { ranking, username } | null.
export async function rankingOwner(rankingId) {
    const { data, error } = await selectRankings(q => q.eq("id", rankingId).maybeSingle());
    if (error || !data) return null;
    const names = await usernames([data.user_id]).catch(() => new Map());
    return { ranking: data, username: names.get(data.user_id) || null };
}

// ── Feed ───────────────────────────────────────────────────────────────
// Posts from you and your friends, newest first, each with its ranking and author:
// { available, posts: [{ id, user_id, username, caption, created_at, ranking, mine }] }.
// Posts whose ranking you can't see any more are left out.
export async function loadFeed({ limit = 40 } = {}) {
    const { supabase, user } = await client();
    if (!supabase || !user) return { available: false, posts: [] };
    const { data, error } = await supabase.from("ranking_posts")
        .select("id, user_id, ranking_id, caption, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
    if (isMissing(error)) return { available: false, posts: [] };
    if (error) throw error;
    const posts = data || [];
    if (!posts.length) return { available: true, posts: [] };

    const rankingIds = [...new Set(posts.map(p => p.ranking_id))];
    const { data: rankings, error: rError } = await selectRankings(q => q.in("id", rankingIds));
    if (rError) throw rError;
    const byId = new Map((rankings || []).map(r => [r.id, r]));
    const names = await usernames(posts.map(p => p.user_id)).catch(() => new Map());
    const activity = await postActivity(posts.map(p => p.id));
    return {
        available: true,
        social: activity.available,   // likes and comments (false before their migration)
        posts: posts
            .filter(p => byId.has(p.ranking_id))
            .map(p => ({
                id: p.id, user_id: p.user_id, caption: p.caption, created_at: p.created_at,
                username: names.get(p.user_id) || "unknown",
                ranking: byId.get(p.ranking_id),
                mine: p.user_id === user.id,
                ...activityFor(p, activity, user.id),
            })),
    };
}

// ── Likes and comments ─────────────────────────────────────────────────
export const COMMENT_MAX = 500;

// Likes and comments on these posts, with usernames (post_activity()):
// { available, rows: [{ post_id, kind: "like" | "comment", id, user_id, username, body, created_at }] }.
async function postActivity(postIds) {
    const { supabase } = await client();
    if (!postIds.length) return { available: true, rows: [] };
    const { data, error } = await supabase.rpc("post_activity", { p_post_ids: postIds });
    if (error) {
        if (isMissing(error)) return { available: false, rows: [] };
        console.warn("[feed] likes and comments couldn't be loaded:", error);
        return { available: false, rows: [] };
    }
    return { available: true, rows: data || [] };
}

// { likes: [{ user_id, username }], liked, comments: [{ id, user_id, username, body,
//   created_at, mine, removable }] } for one post (removable: yours, or on your post).
function activityFor(post, activity, me) {
    const rows = activity.rows.filter(r => r.post_id === post.id);
    const likes = rows.filter(r => r.kind === "like").map(r => ({ user_id: r.user_id, username: r.username || "someone" }));
    const comments = rows.filter(r => r.kind === "comment").map(r => ({
        id: r.id, user_id: r.user_id, username: r.username || "someone", body: r.body, created_at: r.created_at,
        mine: r.user_id === me, removable: r.user_id === me || post.user_id === me,
    }));
    return { likes, liked: likes.some(l => l.user_id === me), comments };
}

export async function likePost(postId) {
    const { supabase } = await client();
    const { error } = await supabase.from("post_likes").insert({ post_id: postId });
    if (error && error.code !== "23505") throw error;   // already liked: fine
}

export async function unlikePost(postId) {
    const { supabase, user } = await client();
    const { error } = await supabase.from("post_likes").delete().eq("post_id", postId).eq("user_id", user.id);
    if (error) throw error;
}

// Returns the new comment { id, created_at }.
export async function addComment(postId, body) {
    const { supabase } = await client();
    const text = String(body || "").trim().slice(0, COMMENT_MAX);
    if (!text) throw new Error("empty");
    const { data, error } = await supabase.from("post_comments")
        .insert({ post_id: postId, body: text }).select("id, created_at").single();
    if (error) throw error;
    return { ...data, body: text };
}

export async function deleteComment(commentId) {
    const { supabase } = await client();
    const { error } = await supabase.from("post_comments").delete().eq("id", commentId);
    if (error) throw error;
}

// Your posts of one ranking (to show "Shared" on its page), newest first.
export async function myPostsOf(rankingId) {
    const { supabase, user } = await client();
    if (!supabase || !user) return [];
    const { data, error } = await supabase.from("ranking_posts")
        .select("id, created_at").eq("ranking_id", rankingId).eq("user_id", user.id)
        .order("created_at", { ascending: false });
    if (isMissing(error)) return null;   // null: sharing isn't set up on this database yet
    if (error) throw error;
    return data || [];
}

export async function shareRanking(rankingId, caption) {
    const { supabase } = await client();
    const text = String(caption || "").trim().slice(0, CAPTION_MAX) || null;
    const { error } = await supabase.from("ranking_posts").insert({ ranking_id: rankingId, caption: text });
    if (error) throw error;
}

export async function deletePost(postId) {
    const { supabase } = await client();
    const { error } = await supabase.from("ranking_posts").delete().eq("id", postId);
    if (error) throw error;
}

// ── Public folders ─────────────────────────────────────────────────────
// Someone's folders that friends can see (yours too, on your own profile), with what's
// in them: { folders: [{ id, name, section }], items: [{ folder_id, ranking_id }] }.
// Empty before the public-folders migration.
export async function publicFoldersOf(userId) {
    const { supabase } = await client();
    const none = { folders: [], items: [] };
    if (!supabase) return none;
    const { data: folders, error } = await supabase.from("ranking_folders")
        .select("id, name, section, created_at")
        .eq("user_id", userId).eq("is_public", true)
        .order("created_at", { ascending: true });
    if (error) {
        if (["42703", "PGRST204", "42P01", "PGRST205"].includes(error.code)) return none;
        throw error;
    }
    if (!folders?.length) return none;
    const { data: items, error: iError } = await supabase.from("ranking_folder_items")
        .select("folder_id, ranking_id").in("folder_id", folders.map(f => f.id));
    if (iError) throw iError;
    return { folders, items: items || [] };
}

// ── Friends' rankings of the same thing ────────────────────────────────
// Your friends' rankings of the same album / artist as this one (any edition of an
// album; for custom rankings, the same kind), newest per friend first, each with the
// friend's username: [{ ranking, username }]. Row-level security only returns friends'.
export async function friendsRankingsOf(ranking) {
    const { supabase, user } = await client();
    if (!supabase || !user || !ranking?.kind) return [];
    const { data, error } = await selectRankings(q => {
        let query = q.eq("kind", ranking.kind).neq("user_id", user.id)
            .order("updated_at", { ascending: false }).limit(300);
        // Albums are matched by edition too (different ids), so only they need all.
        if (ranking.kind !== "album" && ranking.source_id) query = query.eq("source_id", ranking.source_id);
        return query;
    });
    if (error) { console.warn("[friends] rankings couldn't be loaded:", error); return []; }
    const newestPerFriend = new Map();
    for (const r of data || []) {
        if (newestPerFriend.has(r.user_id)) continue;
        if (await sameSubject(r, ranking)) newestPerFriend.set(r.user_id, r);
    }
    if (!newestPerFriend.size) return [];
    const names = await usernames([...newestPerFriend.keys()]).catch(() => new Map());
    return [...newestPerFriend.values()]
        .map(r => ({ ranking: r, username: names.get(r.user_id) || "friend" }))
        .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: "base" }));
}
