// saved-rankings.js — saving rankings to a TuneVis account (public.rankings in
// supabase/schema.sql) and opening them again.
//
// A saved ranking stores the same state the ranking page's URL carries (kind, source,
// size, order, name), so reopening one is just a link to rank.html / rank-general.html
// with ?saved=<id> added; saving again from that page updates the same row.
import { accountsConfigured, getSupabase, getUser, loginUrl } from "./supabase.js";

const BASE_COLUMNS = "id, kind, source_id, source_name, genre, title, size, item_ids, items, image, updated_at";
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
    artist: "Artist ranking",
    album: "Album ranking",
    fav_artists: "Favourite artists",
    fav_tracks: "Favourite tracks",
};

export function rankingUrl(r) {
    const p = new URLSearchParams();
    let page;
    if (r.kind === "artist" || r.kind === "album") {
        page = "rank.html";
        p.set("type", r.kind);
        p.set("id", r.source_id);
    } else {
        page = "rank-general.html";
        p.set("mode", r.kind === "fav_artists" ? "artist" : "track");
        p.set("genre", r.genre || "all");
    }
    p.set("size", String(r.size));
    if (r.item_ids?.length) p.set("order", r.item_ids.join(","));
    p.set("name", r.title);
    if (r.kind === "album" && r.rating != null) p.set("rating", String(Number(r.rating)));
    p.set("saved", r.id);
    return `${page}?${p.toString()}`;
}

// The signed-in user's saved rankings, newest first. null when signed out.
export async function listRankings() {
    const supabase = await getSupabase();
    if (!supabase || !(await getUser())) return null;
    const { data, error } = await selectRankings(q =>
        q.order("updated_at", { ascending: false }).limit(200));
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
// Returns { refresh(), reset() }: call refresh() after every change to the ranking and
// reset() when the page switches to a different ranking.
export function initSaveButton({ button, getRecord, getSavedId, setSavedId, emptyMessage }) {
    const noop = { refresh() {}, reset() {} };
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
        if (!id || !(await getUser())) return refresh();
        const { data } = await selectRankings(q => q.eq("id", id).maybeSingle());
        if (id !== getSavedId()) return;          // the page moved on while this loaded
        if (data) lastSaved = comparable(data);
        else setSavedId(null);                    // deleted, or someone else's link
        refresh();
    }

    button.addEventListener("click", async () => {
        const user = await getUser();
        if (!user) { window.location.href = loginUrl(); return; }

        const record = getRecord();
        // A ranking needs something in it: at least one ranked item, or (albums) a star
        // rating on its own, so an album can be rated before its tracks are ordered.
        if (!record.item_ids.length && !record.rating) {
            alert(emptyMessage || "Add something to your ranking before saving.");
            return;
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
        } catch (err) {
            console.error("[accounts] Could not save ranking:", err);
            saving = false;
            flash("Couldn't save");
        } finally {
            button.disabled = false;
        }
    });

    loadSavedState();
    return { refresh, reset: loadSavedState };
}

// ── Folders ────────────────────────────────────────────────────────────
// Folders group saved rankings ("Favourites", "2026 Releases"). A ranking can be in
// any number of folders; public.ranking_folder_items links them.
export const FOLDER_NAME_MAX = 40;
export const FOLDER_LIMIT = 50;

// The tables don't exist until the folders migration has been run.
const isMissingTable = error => error?.code === "42P01" || error?.code === "PGRST205";

// { folders: [{ id, name }], items: [{ folder_id, ranking_id }], available }.
// available is false if the database hasn't got folders yet (or the user is signed out).
export async function loadFolders() {
    const supabase = await getSupabase();
    if (!supabase || !(await getUser())) return { folders: [], items: [], available: false };
    const [f, i] = await Promise.all([
        supabase.from("ranking_folders").select("id, name, created_at").order("created_at", { ascending: true }),
        supabase.from("ranking_folder_items").select("folder_id, ranking_id"),
    ]);
    if (isMissingTable(f.error) || isMissingTable(i.error)) return { folders: [], items: [], available: false };
    if (f.error) throw f.error;
    if (i.error) throw i.error;
    return { folders: f.data || [], items: i.data || [], available: true };
}

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

// Returns { folder } or { error }.
export async function createFolder(name) {
    const supabase = await getSupabase();
    const value = String(name).trim();
    const { data, error } = await supabase.from("ranking_folders").insert({ name: value }).select("id, name, created_at").single();
    if (error) return { error: error.code === "23505" ? duplicateName(value) : "That folder couldn't be created just now." };
    return { folder: data };
}

export async function renameFolder(id, name) {
    const supabase = await getSupabase();
    const value = String(name).trim();
    const { error } = await supabase.from("ranking_folders").update({ name: value }).eq("id", id);
    if (error) return { error: error.code === "23505" ? duplicateName(value) : "That folder couldn't be renamed just now." };
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
