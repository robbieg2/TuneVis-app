// rank-view.js — the read-only "finished list" view of a saved ranking, shared by
// rank.html and rank-general.html. A saved ranking opens in this view; the page's
// Edit button switches to the two-column workspace (#rank-edit) and its Done button
// switches back.
import { esc } from "./auth.js";

const viewEl = document.getElementById("rank-view");
const editEl = document.getElementById("rank-edit");
const titleEl = document.getElementById("rank-view-title");
const metaEl = document.getElementById("rank-view-meta");
const listEl = document.getElementById("rank-view-list");

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
