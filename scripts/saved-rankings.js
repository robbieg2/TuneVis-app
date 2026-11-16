// saved-rankings.js — saving rankings to a TuneVis account (public.rankings in
// supabase/schema.sql) and opening them again.
//
// A saved ranking stores the same state the ranking page's URL carries (kind, source,
// size, order, name), so reopening one is just a link to rank.html / rank-general.html
// with ?saved=<id> added; saving again from that page updates the same row.
import { accountsConfigured, getSupabase, getUser, loginUrl } from "./supabase.js";

const COLUMNS = "id, kind, source_id, source_name, genre, title, size, item_ids, items, image, updated_at";

// The fields that make up a ranking, in a fixed order, so two can be compared as JSON.
function comparable(r) {
    return JSON.stringify([
        r.kind, r.source_id ?? null, r.genre ?? null, r.title, r.size, r.item_ids,
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
    p.set("saved", r.id);
    return `${page}?${p.toString()}`;
}

// The signed-in user's saved rankings, newest first. null when signed out.
export async function listRankings() {
    const supabase = await getSupabase();
    if (!supabase || !(await getUser())) return null;
    const { data, error } = await supabase
        .from("rankings")
        .select(COLUMNS)
        .order("updated_at", { ascending: false })
        .limit(100);
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
        const supabase = await getSupabase();
        const { data } = await supabase.from("rankings").select(COLUMNS).eq("id", id).maybeSingle();
        if (id !== getSavedId()) return;          // the page moved on while this loaded
        if (data) lastSaved = comparable(data);
        else setSavedId(null);                    // deleted, or someone else's link
        refresh();
    }

    button.addEventListener("click", async () => {
        const user = await getUser();
        if (!user) { window.location.href = loginUrl(); return; }

        const record = getRecord();
        if (!record.item_ids.length) { alert(emptyMessage || "Add something to your ranking before saving."); return; }

        const supabase = await getSupabase();
        saving = true;
        button.disabled = true;
        button.textContent = "Saving…";
        try {
            let id = getSavedId();
            if (id) {
                const { data, error } = await supabase.from("rankings").update(record).eq("id", id).select("id");
                if (error) throw error;
                if (!data?.length) id = null;     // not this user's row (e.g. a shared link)
            }
            if (!id) {
                const { data, error } = await supabase.from("rankings").insert(record).select("id").single();
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
