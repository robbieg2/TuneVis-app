// supabase.js — the TuneVis accounts client and shared account helpers.
//
// supabase-js is loaded from a pinned CDN build with a dynamic import, so if the CDN
// is unreachable (or accounts aren't configured) only account features switch off —
// the music pages, which import this module indirectly, keep working.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";

const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";

function projectUrl() {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
    // The dashboard also shows the REST URL (…/rest/v1); the client needs the origin.
    try { return new URL(SUPABASE_URL).origin; } catch { return null; }
}

export const accountsConfigured = Boolean(projectUrl());

let clientPromise = null;

// The shared client, or null when accounts are unavailable.
export function getSupabase() {
    if (!accountsConfigured) return Promise.resolve(null);
    if (!clientPromise) {
        clientPromise = import(SUPABASE_JS)
            .then(({ createClient }) => createClient(projectUrl(), SUPABASE_ANON_KEY, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    // Email links are verified explicitly on auth-confirm.html.
                    detectSessionInUrl: false,
                    storageKey: "tunevis_auth",
                },
            }))
            .catch(err => {
                console.error("[accounts] Could not load Supabase:", err);
                return null;
            });
    }
    return clientPromise;
}

// { id, email, username } from a Supabase user. username is the display copy kept in
// user_metadata (profile.js); the user can write their own metadata, so it's only
// used if it still looks like a valid username, and only for display.
function toUser(u) {
    if (!u) return null;
    const name = u.user_metadata?.username;
    const username = typeof name === "string" && /^[A-Za-z0-9_]{3,20}$/.test(name) ? name : null;
    return { id: u.id, email: u.email || "", username };
}

// The signed-in user ({ id, email, username }) or null. Reads the stored session; the
// database itself checks the token on every request, so this is only used to shape the UI.
export async function getUser() {
    const supabase = await getSupabase();
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return toUser(data?.session?.user);
}

// Calls fn(user | null) now and whenever the user signs in or out or their account
// changes (in any tab).
export async function onUserChange(fn) {
    const supabase = await getSupabase();
    if (!supabase) { fn(null); return; }
    fn(await getUser());
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
            fn(toUser(session?.user));
        }
    });
}

// The page to return to after signing in, as a same-site path, e.g. "/rank.html?…".
export function currentPath() {
    return `${window.location.pathname}${window.location.search}`;
}

export function loginUrl(next = currentPath()) {
    return `login.html?next=${encodeURIComponent(next)}`;
}

// Only same-site paths are allowed as a post-login destination, so a crafted
// ?next=https://evil.example link can't bounce someone off-site after signing in.
export function safeNext(next, fallback = "home.html") {
    if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return fallback;
    if (next.includes("\\") || /[\r\n]/.test(next)) return fallback;
    return next;
}

// ── Error messages ────────────────────────────────────────────────────
// Supabase auth errors turned into plain messages. Unknown errors get a generic
// message rather than the raw text.
export const NOT_CONFIGURED = "Sign-in isn't available right now.";

function logAuthError(error) {
    const message = String(error?.message ?? "").replace(/[^\s@"']+@[^\s@"']+/g, "<email>");
    console.error("[accounts] Supabase error", { code: error?.code, status: error?.status, message });
}

export function authErrorMessage(error) {
    if (!error) return "Something went wrong — please try again.";
    logAuthError(error);
    const code = error.code ?? "";
    const message = error.message ?? "";

    if (code === "signup_disabled" || /signups not allowed/i.test(message)) {
        return "Sign-ups are closed at the moment.";
    }
    if (code === "invalid_credentials") return "Email or password is incorrect.";
    if (code === "email_not_confirmed") {
        return "Please confirm your email first — check your inbox for the link.";
    }
    if (code === "user_already_exists" || code === "email_exists") {
        return "An account with this email already exists — try signing in.";
    }
    if (code === "weak_password") return message || "Please choose a stronger password.";
    if (code === "same_password") return "Your new password must be different from the old one.";
    if (code.startsWith("over_") || error.status === 429) {
        return "Too many attempts — please wait a few minutes and try again.";
    }
    if (code === "otp_expired") return "That link has expired or has already been used.";
    // Supabase's built-in email only delivers to the project's team members until
    // custom SMTP is set up.
    if (code === "email_address_not_authorized") {
        return "We can't send emails to this address yet — sign-ups aren't open to everyone.";
    }
    if (code === "email_address_invalid") {
        return "That email address isn't accepted — please use a different one.";
    }
    if (/error sending .*email/i.test(message)) {
        return "We couldn't send the email just now — please try again later.";
    }
    if (error.name === "TypeError" || /failed to fetch/i.test(message)) {
        return "Couldn't reach the server — check your connection and try again.";
    }
    return "Something went wrong — please try again.";
}
