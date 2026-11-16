// content-page.js — About, Help & FAQ, Privacy, Terms and 404 pages.
// The header's back button returns to the previous TuneVis page, or to the home
// page if the visitor arrived here directly (from a search result or a shared link).
const backBtn = document.getElementById("back-btn");

if (backBtn) {
    backBtn.addEventListener("click", () => {
        let cameFromTuneVis = false;
        try { cameFromTuneVis = new URL(document.referrer).origin === window.location.origin; } catch {}
        if (cameFromTuneVis && history.length > 1) history.back();
        else window.location.href = "/home.html";
    });
}
