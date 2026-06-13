// auth.js — Client Credentials token fetch via Vercel serverless function
// /api/token is a relative URL — works automatically on any domain Vercel deploys to.

const TOKEN_ENDPOINT = "/api/token";

/**
 * Returns a valid Spotify access token.
 * Caches the token in localStorage and auto-refreshes when it expires.
 */
export async function getSpotifyToken() {
  const cached = localStorage.getItem("spotify_cc_token");

  if (cached) {
    try {
      const { access_token, expires_at } = JSON.parse(cached);
      // Treat as valid if more than 60 seconds remain
      if (access_token && Date.now() < expires_at - 60_000) {
        return access_token;
      }
    } catch {
      // Cached value was malformed — fall through to fetch
    }
  }

  const res = await fetch(TOKEN_ENDPOINT);
  if (!res.ok) throw new Error(`Token endpoint responded ${res.status}`);

  const { access_token, expires_in } = await res.json();
  if (!access_token) throw new Error("No access_token in response");

  localStorage.setItem(
    "spotify_cc_token",
    JSON.stringify({ access_token, expires_at: Date.now() + expires_in * 1000 })
  );

  // Keep the legacy key so features-data.js spotifyFetch() continues to work unchanged
  localStorage.setItem("access_token", access_token);

  return access_token;
}
