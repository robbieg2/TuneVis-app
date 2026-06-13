// api/token.js — Vercel Serverless Function
// Vercel auto-detects any file in /api as a serverless endpoint.
//
// Set two Environment Variables in your Vercel project settings:
//   SPOTIFY_CLIENT_ID
//   SPOTIFY_CLIENT_SECRET

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const credentials = Buffer.from(
      `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
    ).toString("base64");

    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      return res.status(502).json({ error: "Spotify token request failed", detail: text });
    }

    const { access_token, expires_in } = await tokenRes.json();
    return res.status(200).json({ access_token, expires_in });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
