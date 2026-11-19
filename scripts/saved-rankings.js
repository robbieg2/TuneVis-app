// saved-rankings.js — saving rankings to a TuneVis account (public.rankings in
// supabase/schema.sql) and opening them again.
//
// A saved ranking stores the same state the ranking page's URL carries (kind, source,
// size, order, name), so reopening one is just a link to rank.html / rank-general.html
// with ?saved=<id> added; saving again from that page updates the same row.
import { accountsConfigured, getSupabase, getUser, loginUrl } from "./supabase.js";

const BASE_COLUMNS = "id, user_id, kind, source_id, source_name, genre, title, size, item_ids, items, image, updated_at";
const COLUMNS = `${BASE_COLUMNS}, rating`;

// Postgres "column does not exist" / PostgREST "column not found": the ratings
// migration hasn't been run on this database yet.
const isMissingColumn = error => error?.code === "42703" || error?.code === "PGRST204";

// Selects rankings, falling back to the columns that exist before the ratings migration.
async function selectRankings(build) {
    const supabase = await getSupabase();
    let result = await build(supabase.from("rankings").select(COLUMNS));
    if (isMissingColumn(result.error)) result = await build(supabase.from("rankings").select(BASE_COLUMNS));
    return result;
}

// The fields that make up a ranking, in a fixed order, so two can be compared as JSON.
function comparable(r) {
    return JSON.stringify([
        r.kind, r.source_id ?? null, r.genre ?? null, r.title, r.size, r.item_ids,
        r.kind === "album" ? (r.rating == null ? null : Number(r.rating)) : null,
    ]);
}

export const KIND_LABELS = {
    artist: "Artist top tracks",
    artist_albums: "Artist albums & EPs",
    album: "Album ranking",
    fav_artists: "Favourite artists",
    fav_tracks: "Favourite tracks",
};

// The saved rankings page has a tab per section, and each section has its own folders
// (public.ranking_section() in supabase/schema.sql maps kinds the same way).
export const SECTION_OF_KIND = {
    album: "album",
    artist_albums: "artist_albums",
    artist: "artist",
    fav_artists: "favourites",
    fav_tracks: "favourites",
};
export const sectionOf = kind => SECTION_OF_KIND[kind] || "album";

// A saved ranking's page. Without &edit=1 it opens as the finished list.
// { friend: true } for someone else's ranking (social): it opens read-only, with
// from=<id> instead of saved=<id>, so nothing on the page can try to save over it.
export function rankingUrl(r, { friend = false } = {}) {
    const p = new URLSearchParams();
    let page;
    if (r.kind === "artist" || r.kind === "album" || r.kind === "artist_albums") {
        page = "rank.html";
        p.set("type", r.kind === "album" ? "album" : "artist");
        p.set("id", r.source_id);
        if (r.kind === "artist_albums") p.set("list", "albums");
    } else {
        page = "rank-general.html";
        p.set("mode", r.kind === "fav_artists" ? "artist" : "track");
        p.set("genre", r.genre || "all");
    }
    p.set("size", String(r.size));
    if (r.item_ids?.length) p.set("order", r.item_ids.join(","));
    p.set("name", r.title);
    if (r.kind === "album" && r.rating != null) p.set("rating", String(Number(r.rating)));
    p.set(friend ? "from" : "saved", r.id);
    return `${page}?${p.toString()}`;
}

// The signed-in user's saved rankings, newest first. null when signed out.
// Filtered to their own: once they have friends, row-level security also lets them
// read their friends' rankings.
export async function listRankings() {
    const supabase = await getSupabase();
    const user = supabase ? await getUser() : null;
    if (!user) return null;
    const { data, error } = await selectRankings(q =>
        q.eq("user_id", user.id).order("updated_at", { ascending: false }).limit(200));
    if (error) throw error;
    return data || [];
}

export async function deleteRanking(id) {
    const supabase = await getSupabase();
    if (!supabase) throw new Error("Accounts unavailable");
    const { error } = await supabase.from("rankings").delete().eq("id", id);
    if (error) throw error;
}

// Wires up a page's Save button.
//   getRecord()     → { kind, source_id, source_name, genre, title, size, item_ids, items, image }
//   getSavedId()    → the row this page is editing, or null
//   setSavedId(id)  → called after the first save (the page puts it in its URL)
//   emptyMessage    → shown if Save is pressed with nothing ranked
// Returns { refresh(), reset(), isDirty(), save() }: call refresh() after every change
// to the ranking and reset() when the page switches to a different ranking. save()
// does what pressing the button does and resolves true once saved.
export function initSaveButton({ button, getRecord, getSavedId, setSavedId, emptyMessage }) {
    const noop = { refresh() {}, reset() {}, isDirty: () => false, save: async () => true };
    if (!button || !accountsConfigured) return noop;
    button.hidden = false;

    let lastSaved = null;   // comparable() of what's in the database, if known
    let saving = false;

    function refresh() {
        if (saving) return;
        const isSaved = lastSaved !== null && lastSaved === comparable(getRecord());
        button.classList.toggle("saved", isSaved);
        button.textContent = isSaved ? "Saved ✓" : getSavedId() ? "Save changes" : "Save";
    }

    function flash(text) {
        button.textContent = text;
        setTimeout(refresh, 2000);
    }

    // Opening a saved ranking: find out whether it still matches what's stored, so the
    // button can say "Saved" rather than "Save changes".
    async function loadSavedState() {
        lastSaved = null;
        const id = getSavedId();
        const user = id ? await getUser() : null;
        if (!id || !user) return refresh();
        const { data } = await selectRankings(q => q.eq("id", id).maybeSingle());
        if (id !== getSavedId()) return;          // the page moved on while this loaded
        // Only your own row counts: a friend's is readable too, but saving makes a copy.
        if (data && data.user_id === user.id) lastSaved = comparable(data);
        else setSavedId(null);                    // deleted, or someone else's link
        refresh();
    }

    async function save() {
        const user = await getUser();
        if (!user) { window.location.href = loginUrl(); return false; }

        const record = getRecord();
        // A ranking needs something in it: at least one ranked item, or (albums) a star
        // rating on its own, so an album can be rated before its tracks are ordered.
        if (!record.item_ids.length && !record.rating) {
            const message = typeof emptyMessage === "function" ? emptyMessage() : emptyMessage;
            alert(message || "Add something to your ranking before saving.");
            return false;
        }

        const supabase = await getSupabase();
        // Before the ratings migration the column doesn't exist: save everything else.
        const withFallback = async run => {
            let result = await run(record);
            if (isMissingColumn(result.error) && "rating" in record) {
                const { rating: _ignored, ...rest } = record;
                result = await run(rest);
            }
            return result;
        };
        saving = true;
        button.disabled = true;
        button.textContent = "Saving…";
        try {
            let id = getSavedId();
            if (id) {
                const { data, error } = await withFallback(rec =>
                    supabase.from("rankings").update(rec).eq("id", id).select("id"));
                if (error) throw error;
                if (!data?.length) id = null;     // not this user's row (e.g. a shared link)
            }
            if (!id) {
                const { data, error } = await withFallback(rec =>
                    supabase.from("rankings").insert(rec).select("id").single());
                if (error) throw error;
                id = data.id;
                setSavedId(id);
            }
            lastSaved = comparable(record);
            saving = false;
            refresh();
            return true;
        } catch (err) {
            console.error("[accounts] Could not save ranking:", err);
            saving = false;
            flash("Couldn't save");
            return false;
        } finally {
            button.disabled = false;
        }
    }

    button.addEventListener("click", save);

    loadSavedState();
    return {
        refresh,
        reset: loadSavedState,
        isDirty: () => lastSaved === null || lastSaved !== comparable(getRecord()),
        save,
    };
}

// ── Folders ────────────────────────────────────────────────────────────
// Folders group saved rankings ("Favourites", "2026 Releases"). A ranking can be in
// any number of folders; public.ranking_folder_items links them.
export const FOLDER_NAME_MAX = 40;
export const FOLDER_LIMIT = 50;

// The tables don't exist until the folders migration has been run.
const isMissingTable = error => error?.code === "42P01" || error?.code === "PGRST205";

// The signed-in user's own folders:
// { folders: [{ id, name, section, is_public }], items: [{ folder_id, ranking_id }],
//   available, sectioned, publicFolders }.
// available is false if the database hasn't got folders yet (or the user is signed out).
// sectioned is false before the folders-by-kind migration: folders then have no
// section and are shared by every kind of ranking, as before. publicFolders is false
// before the public-folders migration (no is_public column: every folder is private).
// Filtered to the user's own rows: friends' public folders are readable too.
export async function loadFolders() {
    const supabase = await getSupabase();
    const none = { folders: [], items: [], available: false, sectioned: false, publicFolders: false };
    const user = supabase ? await getUser() : null;
    if (!user) return none;
    const selectFolders = columns => supabase.from("ranking_folders").select(columns)
        .eq("user_id", user.id).order("created_at", { ascending: true });
    let [f, i] = await Promise.all([
        selectFolders("id, name, section, is_public, created_at"),
        supabase.from("ranking_folder_items").select("folder_id, ranking_id").eq("user_id", user.id),
    ]);
    if (isMissingTable(f.error) || isMissingTable(i.error)) return none;
    let publicFolders = true, sectioned = true;
    if (isMissingColumn(f.error)) {
        publicFolders = false;
        f = await selectFolders("id, name, section, created_at");
    }
    if (isMissingColumn(f.error)) {
        sectioned = false;
        f = await selectFolders("id, name, created_at");
    }
    if (f.error) throw f.error;
    if (i.error) throw i.error;
    const folders = (f.data || []).map(x => ({ ...x, section: sectioned ? x.section : null, is_public: publicFolders ? Boolean(x.is_public) : false }));
    return { folders, items: i.data || [], available: true, sectioned, publicFolders };
}

// The folders a ranking of this section can go in (all of them before the migration).
export const foldersForSection = (folders, section) =>
    folders.filter(f => f.section == null || f.section === section);

export function folderNameProblem(name, existing = [], ignoreId = null) {
    const value = String(name ?? "").trim();
    if (!value) return "Give the folder a name.";
    if (value.length > FOLDER_NAME_MAX) return `Folder names are at most ${FOLDER_NAME_MAX} characters.`;
    if (existing.some(f => f.id !== ignoreId && f.name.trim().toLowerCase() === value.toLowerCase())) {
        return `You already have a folder called "${value}".`;
    }
    return null;
}

const duplicateName = name => `You already have a folder called "${name}".`;

// A folder in one section ("album", "artist_albums", ...), private unless isPublic
// (visible to friends). Returns { folder } or { error }.
export async function createFolder(name, section, isPublic = false) {
    const supabase = await getSupabase();
    const value = String(name).trim();
    const insert = row => supabase.from("ranking_folders").insert(row).select("id, name, created_at").single();
    let row = { name: value, section, ...(isPublic ? { is_public: true } : {}) };
    let { data, error } = await insert(row);
    if (isMissingColumn(error) && "is_public" in row) {   // before the public-folders migration
        ({ is_public: isPublic, ...row } = row);
        isPublic = false;
        ({ data, error } = await insert(row));
    }
    let saved = section;
    if (isMissingColumn(error)) {       // before the folders-by-kind migration
        ({ data, error } = await insert({ name: value }));
        saved = null;
    }
    if (error) return { error: error.code === "23505" ? duplicateName(value) : "That folder couldn't be created just now." };
    return { folder: { ...data, section: saved, is_public: Boolean(isPublic) } };
}

// Change a folder's name and/or who can see it: changes = { name?, isPublic? }.
export async function updateFolder(id, { name, isPublic } = {}) {
    const supabase = await getSupabase();
    const change = {};
    if (name !== undefined) change.name = String(name).trim();
    if (isPublic !== undefined) change.is_public = Boolean(isPublic);
    const { error } = await supabase.from("ranking_folders").update(change).eq("id", id);
    if (error) return { error: error.code === "23505" ? duplicateName(change.name) : "That folder couldn't be changed just now." };
    return { ok: true };
}

// Deletes the folder only: its rankings stay saved.
export async function deleteFolder(id) {
    const supabase = await getSupabase();
    const { error } = await supabase.from("ranking_folders").delete().eq("id", id);
    if (error) throw error;
}

export async function addToFolder(folderId, rankingId) {
    const supabase = await getSupabase();
    const { error } = await supabase.from("ranking_folder_items").insert({ folder_id: folderId, ranking_id: rankingId });
    if (error && error.code !== "23505") throw error;   // already in it: fine
}

export async function removeFromFolder(folderId, rankingId) {
    const supabase = await getSupabase();
    const { error } = await supabase.from("ranking_folder_items").delete()
        .eq("folder_id", folderId).eq("ranking_id", rankingId);
    if (error) throw error;
}
