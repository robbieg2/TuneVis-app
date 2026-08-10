// auth.js — Client Credentials token + shared localStorage helpers
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

// track: { id, name, artists (string[]), image }
export function saveToRecent(track) {
  if (!track?.id) return;
  try {
    const existing = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    const filtered = Array.isArray(existing) ? existing.filter(t => t?.id !== track.id) : [];
    localStorage.setItem(RECENT_KEY, JSON.stringify([track, ...filtered].slice(0, RECENT_LIMIT)));
  } catch (err) {
    console.error("Could not save to recent:", err);
  }
}

export function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); }
  catch { return []; }
}
