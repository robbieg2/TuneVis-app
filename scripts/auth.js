// auth.js — Client Credentials token + shared localStorage helpers
import { getSupabase, getUser } from "./supabase.js";

const TOKEN_ENDPOINT = "/api/token";
const RECENT_KEY = "tunevis_recent";
const RECENT_LIMIT = 10;

export async function getSpotifyToken(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = localStorage.getItem("spotify_cc_token");
    if (cached) {
      try {
        const { access_token, expires_at } = JSON.parse(cached);
        if (access_token && Date.now() < expires_at - 60_000) return access_token;
      } catch {}
    }
  }
  const res = await fetch(TOKEN_ENDPOINT);
  if (!res.ok) throw new Error(`Token endpoint responded ${res.status}`);
  const { access_token, expires_in } = await res.json();
  if (!access_token) throw new Error("No access_token in response");
  localStorage.setItem("spotify_cc_token", JSON.stringify({ access_token, expires_at: Date.now() + expires_in * 1000 }));
  localStorage.setItem("access_token", access_token);
  return access_token;
}

// ── Recently viewed ──────────────────────────────────────────────────
// Kept in localStorage as before. When signed in to a TuneVis account it's also kept
// in public.recently_viewed, so the list follows the user between devices.

// track: { id, name, artists (string[]), image, viewedAt (ms; missing on old entries) }
export function saveToRecent(track) {
  if (!track?.id) return;
  const entry = { ...track, viewedAt: Date.now() };
  try {
    const filtered = getRecent().filter(t => t?.id !== track.id);
    localStorage.setItem(RECENT_KEY, JSON.stringify([entry, ...filtered].slice(0, RECENT_LIMIT)));
  } catch (err) {
    console.error("Could not save to recent:", err);
  }
  pushRecent([entry]);
}

export function getRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(list) ? list.filter(t => t?.id) : [];
  } catch { return []; }
}

// The Supabase client when someone is signed in, otherwise null.
async function signedInClient() {
  const supabase = await getSupabase();
  return supabase && (await getUser()) ? supabase : null;
}

function toRecentRow(t) {
  return {
    track_id: String(t.id).slice(0, 64),
    name: String(t.name || "Unknown track").slice(0, 300),
    artists: (Array.isArray(t.artists) ? t.artists : []).slice(0, 20).map(a => String(a).slice(0, 300)),
    image: t.image ? String(t.image).slice(0, 500) : null,
    viewed_at: new Date(t.viewedAt || 0).toISOString(),
  };
}

// Fire-and-forget: a failed upload never gets in the way of browsing.
function pushRecent(tracks) {
  if (!tracks.length) return;
  signedInClient()
    .then(supabase => supabase?.from("recently_viewed")
      .upsert(tracks.map(toRecentRow), { onConflict: "user_id,track_id" }))
    .then(res => { if (res?.error) console.error("[accounts] Could not sync recently viewed:", res.error); })
    .catch(err => console.error("[accounts] Could not sync recently viewed:", err));
}

// Merges this browser's list with the account's: newest view of each track wins,
// the result is saved locally, and anything the account didn't have is uploaded.
// Returns the merged list, or null when not signed in (or the sync failed).
export async function syncRecent() {
  try {
    const supabase = await signedInClient();
    if (!supabase) return null;
    const { data, error } = await supabase
      .from("recently_viewed")
      .select("track_id, name, artists, image, viewed_at")
      .order("viewed_at", { ascending: false })
      .limit(RECENT_LIMIT);
    if (error) throw error;

    const remote = (data || []).map(r => ({
      id: r.track_id, name: r.name, artists: r.artists || [], image: r.image || "",
      viewedAt: Date.parse(r.viewed_at) || 0,
    }));
    const remoteTime = new Map(remote.map(t => [t.id, t.viewedAt]));

    // Entries saved before accounts existed have no viewedAt: date them just before the
    // oldest known view, a second apart, so they keep their order on every device.
    const local = getRecent();
    const known = [...remote, ...local].map(t => t.viewedAt).filter(Boolean);
    let undated = (known.length ? Math.min(...known) : Date.now()) - 1000;
    for (const t of local) if (!t.viewedAt) { t.viewedAt = undated; undated -= 1000; }

    const newest = new Map();
    for (const t of [...remote, ...local]) {
      const prev = newest.get(t.id);
      if (!prev || (t.viewedAt || 0) > (prev.viewedAt || 0)) newest.set(t.id, t);
    }
    const merged = [...newest.values()]
      .sort((a, b) => (b.viewedAt || 0) - (a.viewedAt || 0))
      .slice(0, RECENT_LIMIT);

    try { localStorage.setItem(RECENT_KEY, JSON.stringify(merged)); } catch {}
    pushRecent(merged.filter(t => !remoteTime.has(t.id) || (t.viewedAt || 0) > remoteTime.get(t.id)));
    return merged;
  } catch (err) {
    console.error("[accounts] Could not load recently viewed:", err);
    return null;
  }
}

// Escape text before interpolating it into an innerHTML template. Track,
// artist and album names come from Spotify/Last.fm (and on features.html
// straight from the URL), so they must never be treated as markup.
export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
