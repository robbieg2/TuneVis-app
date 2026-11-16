// profile.js — a TuneVis account's username (public.profiles in supabase/schema.sql).
//
// The profiles table is the source of truth and enforces uniqueness (case-insensitive).
// A copy is kept in the account's user_metadata so the header can show it from the
// session without an extra query on every page; it is only ever used for display.
import { getSupabase, getUser } from "./supabase.js";

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
const USERNAME_RE = /^[A-Za-z0-9_]+$/;
// Mirrors the check constraint in supabase/schema.sql.
const RESERVED = new Set([
    "admin", "administrator", "tunevis", "support", "moderator", "mod", "root",
    "system", "help", "official", "staff", "null", "undefined",
]);

// A problem with the username's format, or null if it's fine.
export function usernameProblem(name) {
    const value = String(name ?? "").trim();
    if (!value) return "Choose a username.";
    if (value.length < USERNAME_MIN) return `Usernames are at least ${USERNAME_MIN} characters.`;
    if (value.length > USERNAME_MAX) return `Usernames are at most ${USERNAME_MAX} characters.`;
    if (!USERNAME_RE.test(value)) return "Use only letters, numbers and underscores.";
    if (RESERVED.has(value.toLowerCase())) return "That username is reserved — try another.";
    return null;
}

// The signed-in user's username, or null if they haven't chosen one.
export async function getMyUsername() {
    const supabase = await getSupabase();
    const user = await getUser();
    if (!supabase || !user) return null;
    const { data, error } = await supabase
        .from("profiles")
        .select("username")
        .eq("user_id", user.id)
        .maybeSingle();
    if (error) throw error;
    return data?.username ?? null;
}

// true / false, or null if it couldn't be checked (the save itself still enforces it).
export async function isUsernameAvailable(name) {
    const supabase = await getSupabase();
    if (!supabase) return null;
    const { data, error } = await supabase.rpc("username_available", { name });
    if (error) return null;
    return Boolean(data);
}

// Saves the username. Returns { ok: true } or { error: "message for the user" }.
export async function saveUsername(name) {
    const value = String(name ?? "").trim();
    const problem = usernameProblem(value);
    if (problem) return { error: problem };

    const supabase = await getSupabase();
    const user = await getUser();
    if (!supabase || !user) return { error: "Please sign in again to change your username." };

    const { error } = await supabase
        .from("profiles")
        .upsert({ user_id: user.id, username: value }, { onConflict: "user_id" });
    if (error) {
        if (error.code === "23505") return { error: `@${value} is already taken — try another.` };
        if (error.code === "23514") return { error: "That username isn't allowed — try another." };
        console.error("[accounts] Could not save username:", error);
        return { error: "Your username couldn't be saved just now. Please try again." };
    }

    // Keep the session's copy in step for the header. Not critical if it fails:
    // the account page re-syncs it from the table.
    await supabase.auth.updateUser({ data: { username: value } }).catch(() => {});
    return { ok: true };
}

// Brings the session's copy in line with the table (e.g. changed on another device).
export async function syncUsernameToSession(username) {
    const supabase = await getSupabase();
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const current = data?.session?.user?.user_metadata?.username ?? null;
    if ((username ?? null) !== current) {
        await supabase.auth.updateUser({ data: { username: username ?? null } }).catch(() => {});
    }
}
