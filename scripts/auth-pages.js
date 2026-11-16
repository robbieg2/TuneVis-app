// auth-pages.js — sign in, sign up, password reset, email-link confirm and account
// pages. Each page says which it is with <body data-auth-page="…">.
import {
    getSupabase, getUser, safeNext, loginUrl, authErrorMessage, NOT_CONFIGURED,
} from "./supabase.js";
import { clearRecentCache } from "./auth.js";

const MIN_PASSWORD = 8;
const page = document.body.dataset.authPage;
const params = new URLSearchParams(window.location.search);
const noticeEl = document.getElementById("auth-notice");
const form = document.getElementById("auth-form");

const backBtn = document.getElementById("back-btn");
if (backBtn) {
    backBtn.addEventListener("click", () => {
        if (history.length > 1) history.back();
        else window.location.href = "home.html";
    });
}

const looksLikeEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function showNotice(text, tone = "error", el = noticeEl) {
    if (!el) return;
    el.textContent = text;
    el.className = `auth-notice ${tone}`;
    el.hidden = !text;
}

// Disables the form while a request is in flight so a double click can't send twice.
async function busy(formEl, fn) {
    const buttons = formEl.querySelectorAll("button");
    buttons.forEach(b => { b.disabled = true; });
    try { await fn(); }
    finally { buttons.forEach(b => { b.disabled = false; }); }
}

function field(formEl, name) {
    const value = formEl.elements[name]?.value;
    return typeof value === "string" ? value : "";
}

// Where email links (confirm, reset) come back to: this deploy, local or Vercel.
const confirmUrl = () => new URL("auth-confirm.html", window.location.href).href;

function checkNewPassword(password, confirm) {
    if (password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
    if (password !== confirm) return "The passwords don't match.";
    return null;
}

// ── Sign in ───────────────────────────────────────────────────────────
async function initLogin(supabase) {
    const next = safeNext(params.get("next"));
    // Carry ?next= on to the sign-up page so a new account lands back here too.
    const signupLink = document.getElementById("signup-link");
    if (signupLink && params.get("next")) signupLink.href = `signup.html?next=${encodeURIComponent(next)}`;

    if (params.get("deleted")) showNotice("Your account and all its data have been deleted.", "success");
    else if (params.get("error") === "link") showNotice("That link has expired or has already been used. Please try again.");
    else if (params.get("next")) showNotice("Sign in to save your rankings and recently viewed tracks.", "info");

    if (await getUser()) { window.location.replace(next); return; }

    form.addEventListener("submit", e => {
        e.preventDefault();
        busy(form, async () => {
            const email = field(form, "email").trim();
            const password = field(form, "password");
            if (!looksLikeEmail(email) || !password) return showNotice("Enter your email and password.");
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) return showNotice(authErrorMessage(error));
            // Start from the account's own list, never a previous user's cached copy.
            clearRecentCache();
            window.location.href = next;
        });
    });
}

// ── Sign up ───────────────────────────────────────────────────────────
async function initSignup(supabase) {
    const loginLink = document.getElementById("login-link");
    if (loginLink && params.get("next")) {
        loginLink.href = `login.html?next=${encodeURIComponent(safeNext(params.get("next")))}`;
    }
    if (await getUser()) { window.location.replace("account.html"); return; }

    form.addEventListener("submit", e => {
        e.preventDefault();
        busy(form, async () => {
            const email = field(form, "email").trim();
            const password = field(form, "password");
            if (!looksLikeEmail(email)) return showNotice("Enter a valid email address.");
            const problem = checkNewPassword(password, field(form, "confirm"));
            if (problem) return showNotice(problem);

            const { error } = await supabase.auth.signUp({
                email,
                password,
                options: { emailRedirectTo: confirmUrl() },
            });
            if (error) return showNotice(authErrorMessage(error));
            // Supabase deliberately gives the same response for an email that's already
            // registered, so this message doesn't reveal who has an account.
            form.hidden = true;
            showNotice(`Check ${email} for a link to confirm your account.`, "success");
        });
    });
}

// ── Forgot password ──────────────────────────────────────────────────
function initForgot(supabase) {
    form.addEventListener("submit", e => {
        e.preventDefault();
        busy(form, async () => {
            const email = field(form, "email").trim();
            if (!looksLikeEmail(email)) return showNotice("Enter a valid email address.");
            const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: confirmUrl() });
            // Rate limits are worth reporting; anything else gets the same neutral message,
            // so the form doesn't reveal whether an account exists.
            if (error && (error.status === 429 || error.code?.startsWith("over_"))) {
                return showNotice(authErrorMessage(error));
            }
            form.hidden = true;
            showNotice(`If there's an account for ${email}, a reset link is on its way.`, "success");
        });
    });
}

// ── Choose a new password (from a reset link, or the account page) ──────
async function initUpdatePassword(supabase) {
    if (params.get("invite")) showNotice("Welcome! Choose a password for your account.", "info");
    if (!(await getUser())) {
        form.hidden = true;
        showNotice("This reset link has expired. Please request a new one from the sign-in page.");
        return;
    }

    form.addEventListener("submit", e => {
        e.preventDefault();
        busy(form, async () => {
            const password = field(form, "password");
            const problem = checkNewPassword(password, field(form, "confirm"));
            if (problem) return showNotice(problem);
            const { error } = await supabase.auth.updateUser({ password });
            if (error) {
                if (error.code === "session_not_found" || error.status === 401) {
                    return showNotice("This reset link has expired. Please request a new one.");
                }
                return showNotice(authErrorMessage(error));
            }
            window.location.href = "account.html?updated=1";
        });
    });
}

// ── Email links land here ─────────────────────────────────────────────
// The Supabase email templates link to auth-confirm.html?token_hash=…&type=…
// (see README). Verifying the hash signs the user in, on whichever device opened it.
const LINK_TYPES = ["signup", "email", "recovery", "invite", "email_change", "magiclink"];

async function initConfirm(supabase) {
    const tokenHash = params.get("token_hash");
    const type = params.get("type");
    if (!tokenHash || !LINK_TYPES.includes(type)) { window.location.replace("login.html?error=link"); return; }

    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) { window.location.replace("login.html?error=link"); return; }
    clearRecentCache();

    // A reset link signs the user in so they can choose a new password.
    if (type === "recovery") window.location.replace("update-password.html");
    else if (type === "invite") window.location.replace("update-password.html?invite=1");
    else window.location.replace("account.html?welcome=1");
}

// ── Account ───────────────────────────────────────────────────────────
async function initAccount(supabase) {
    const user = await getUser();
    if (!user) { window.location.replace(loginUrl("/account.html")); return; }

    document.getElementById("account-email").textContent = user.email;
    document.getElementById("account-body").hidden = false;
    if (params.get("welcome")) showNotice("Your email is confirmed — welcome to TuneVis!", "success");
    else if (params.get("updated")) showNotice("Your password has been changed.", "success");

    document.getElementById("sign-out-btn").addEventListener("click", async () => {
        await supabase.auth.signOut();
        clearRecentCache();
        window.location.href = "home.html";
    });

    const deleteForm = document.getElementById("delete-form");
    const deleteNotice = document.getElementById("delete-notice");
    deleteForm.addEventListener("submit", e => {
        e.preventDefault();
        busy(deleteForm, async () => {
            const typed = field(deleteForm, "confirm_email").trim().toLowerCase();
            if (!typed || typed !== user.email.toLowerCase()) {
                return showNotice("That doesn't match your email address, so nothing was deleted.", "error", deleteNotice);
            }
            const { data } = await supabase.auth.getSession();
            const token = data?.session?.access_token;
            if (!token) { window.location.replace(loginUrl("/account.html")); return; }

            let ok = false;
            try {
                const res = await fetch("/api/delete-account", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ confirm_email: typed }),
                });
                ok = res.ok;
            } catch {}
            if (!ok) {
                return showNotice("Your account couldn't be deleted just now. Nothing was removed — please try again.", "error", deleteNotice);
            }
            // The user no longer exists; clear this browser's session.
            await supabase.auth.signOut({ scope: "local" });
            clearRecentCache();
            window.location.replace("login.html?deleted=1");
        });
    });
}

// ── Start ─────────────────────────────────────────────────────────────
const INIT = {
    login: initLogin,
    signup: initSignup,
    "forgot-password": initForgot,
    "update-password": initUpdatePassword,
    "auth-confirm": initConfirm,
    account: initAccount,
};

async function start() {
    const supabase = await getSupabase();
    if (!supabase) {
        if (form) form.hidden = true;
        if (page === "auth-confirm") document.querySelector(".auth-card").innerHTML = `<p class="auth-notice error">${NOT_CONFIGURED}</p>`;
        showNotice(NOT_CONFIGURED);
        return;
    }
    try {
        await INIT[page]?.(supabase);
    } catch (err) {
        showNotice(authErrorMessage(err));
    }
}

start();
