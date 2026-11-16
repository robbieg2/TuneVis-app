// account-nav.js — the round account button in the page header: a person icon linking
// to sign in, or the user's initial linking to their account page. Nothing is shown
// when accounts aren't configured.
import { accountsConfigured, onUserChange, loginUrl } from "./supabase.js";

const PERSON_ICON = `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="6" r="4"/><path d="M2 19c0-4.4 3.6-7 8-7s8 2.6 8 7z"/></svg>`;

function initAccountNav() {
    if (!accountsConfigured) return;
    const header = document.querySelector("header");
    if (!header) return;

    const chip = document.createElement("a");
    chip.className = "account-chip";
    header.classList.add("has-account-chip");
    header.appendChild(chip);

    function render(user) {
        chip.classList.toggle("signed-in", Boolean(user));
        if (user) {
            chip.href = "account.html";
            chip.title = `Your account (${user.email})`;
            chip.setAttribute("aria-label", "Your account");
            chip.textContent = (user.email || "?").charAt(0).toUpperCase();
        } else {
            chip.href = loginUrl();
            chip.title = "Sign in";
            chip.setAttribute("aria-label", "Sign in");
            chip.innerHTML = PERSON_ICON;
        }
    }

    render(null);
    // Sign-in links carry the current page (including ranking state) as ?next=, so
    // refresh the link just before it's followed.
    chip.addEventListener("click", () => {
        if (!chip.classList.contains("signed-in")) chip.href = loginUrl();
    });
    onUserChange(render);
}

initAccountNav();
