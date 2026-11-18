// rank-view.js — the read-only "finished list" view of a saved ranking, shared by
// rank.html and rank-general.html. A saved ranking opens in this view; the page's
// Edit button switches to the two-column workspace (#rank-edit) and its Done button
// switches back. Under a saved ranking the view also has Add to folder and Delete.
import { esc } from "./auth.js";
import { getUser } from "./supabase.js";
import { deleteRanking, sectionOf } from "./saved-rankings.js";
import { openFoldersDialog } from "./folder-dialog.js";

const viewEl = document.getElementById("rank-view");
const editEl = document.getElementById("rank-edit");
const titleEl = document.getElementById("rank-view-title");
const metaEl = document.getElementById("rank-view-meta");
const listEl = document.getElementById("rank-view-list");

const FOLDER_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h3.76a2 2 0 0 1 1.42.59L12.1 6H18.5A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>`;
const TRASH_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z"/></svg>`;

// ── Add to folder / Delete, for a ranking saved to the signed-in user's account ──
let savedRanking = null;    // { id, kind, title } or null
let manageCheck = 0;
const manageEl = document.createElement("div");
manageEl.className = "rank-view-manage";
manageEl.hidden = true;
manageEl.innerHTML = `
    <button type="button" class="rank-folder-btn">${FOLDER_ICON}Add to folder</button>
    <button type="button" class="rank-delete-btn danger">${TRASH_ICON}Delete ranking</button>`;
viewEl?.appendChild(manageEl);

// Pages call this whenever the saved ranking behind the view changes (null: none).
// The buttons only show once the user is known to be signed in; a saved id that isn't
// theirs is cleared by the Save button's check (initSaveButton), which calls this again.
export async function setSavedRanking(ranking) {
    savedRanking = ranking?.id ? ranking : null;
    const check = ++manageCheck;
    if (!savedRanking) { manageEl.hidden = true; return; }
    const user = await getUser().catch(() => null);
    if (check !== manageCheck) return;
    manageEl.hidden = !user;
}

manageEl.querySelector(".rank-folder-btn").addEventListener("click", () => {
    if (savedRanking) openFoldersDialog(savedRanking);
});

manageEl.querySelector(".rank-delete-btn").addEventListener("click", async e => {
    const r = savedRanking;
    if (!r || !confirm(`Delete "${r.title}"? This can't be undone.`)) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
        await deleteRanking(r.id);
        window.location.href = `rankings.html?type=${encodeURIComponent(sectionOf(r.kind))}#saved-rankings`;
    } catch (err) {
        console.error(err);
        btn.disabled = false;
        alert("That ranking couldn't be deleted just now. Please try again.");
    }
});

// Shows the view (true) or the workspace (false).
export function setViewMode(viewing) {
    if (viewEl) viewEl.hidden = !viewing;
    if (editEl) editEl.hidden = viewing;
}

// items: [{ name, subtitle, image, round, href?, badgeHtml? }]
// With href the whole row is a link (e.g. an artist's album → its own album ranking).
// badgeHtml is trusted markup built by the caller (stars, a status label).
export function renderRankView({ title, meta = "", items = [], emptyText = "Nothing ranked yet." }) {
    if (!viewEl) return;
    titleEl.textContent = title;
    metaEl.textContent = meta;
    metaEl.hidden = !meta;
    if (!items.length) {
        listEl.innerHTML = `<li class="rank-view-empty">${esc(emptyText)}</li>`;
        return;
    }
    listEl.innerHTML = items.map((item, i) => {
        const inner = `
            <span class="rank-view-num">${i + 1}</span>
            ${item.image
                ? `<img class="rank-view-img${item.round ? " round" : ""}" src="${esc(item.image)}" alt="">`
                : `<div class="rank-view-img rank-result-placeholder${item.round ? " round" : ""}"></div>`}
            <div class="rank-view-text">
                <span class="rank-view-name">${esc(item.name)}</span>
                ${item.subtitle ? `<span class="rank-view-sub">${esc(item.subtitle)}</span>` : ""}
            </div>
            ${item.badgeHtml ? `<span class="rank-view-badge">${item.badgeHtml}</span>` : ""}`;
        const classes = `rank-view-item${i < 3 ? ` podium podium-${i + 1}` : ""}${item.href ? " has-link" : ""}`;
        return item.href
            ? `<li class="${classes}"><a class="rank-view-link" href="${esc(item.href)}">${inner}</a></li>`
            : `<li class="${classes}">${inner}</li>`;
    }).join("");
}
