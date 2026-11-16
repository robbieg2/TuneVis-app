// api/delete-account.js — Vercel Serverless Function
// Deletes the signed-in TuneVis account. Their saved rankings and recently viewed
// tracks go with it via `on delete cascade` (supabase/schema.sql).
//
// This is the only place the Supabase service-role (secret) key is used. Set two
// Environment Variables in your Vercel project settings (never in the browser code):
//   SUPABASE_URL               (https://<ref>.supabase.co)
//   SUPABASE_SERVICE_ROLE_KEY  (Project Settings → API → service_role / secret key)
//
// Who to delete comes from the verified access token, never from the request body.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let base;
  try { base = new URL(process.env.SUPABASE_URL || "").origin; } catch {}
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !serviceKey) {
    return res.status(503).json({ error: "Account deletion is not configured" });
  }

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "Not signed in" });

  try {
    // Supabase checks the token's signature and expiry and returns its user.
    const userRes = await fetch(`${base}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
    });
    if (!userRes.ok) return res.status(401).json({ error: "Not signed in" });
    const user = await userRes.json();
    if (!user?.id) return res.status(401).json({ error: "Not signed in" });

    // The page asks the user to type their email; check it here too.
    const body = typeof req.body === "string" ? safeJson(req.body) : req.body || {};
    const typed = String(body?.confirm_email || "").trim().toLowerCase();
    if (!typed || typed !== String(user.email || "").toLowerCase()) {
      return res.status(400).json({ error: "Email confirmation does not match" });
    }

    const delRes = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
      method: "DELETE",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!delRes.ok) {
      console.error("[delete-account] Supabase refused deletion", delRes.status);
      return res.status(502).json({ error: "Could not delete account" });
    }

    return res.status(200).json({ deleted: true });
  } catch (err) {
    console.error("[delete-account]", err?.message);
    return res.status(500).json({ error: "Could not delete account" });
  }
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return {}; }
}
