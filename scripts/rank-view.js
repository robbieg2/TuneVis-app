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

// items: [{ name, subtitle, image, round }]
export function renderRankView({ title, meta = "", items = [], emptyText = "Nothing ranked yet." }) {
    if (!viewEl) return;
    titleEl.textContent = title;
    metaEl.textContent = meta;
    metaEl.hidden = !meta;
    if (!items.length) {
        listEl.innerHTML = `<li class="rank-view-empty">${esc(emptyText)}</li>`;
        return;
    }
    listEl.innerHTML = items.map((item, i) => `
        <li class="rank-view-item${i < 3 ? ` podium podium-${i + 1}` : ""}">
            <span class="rank-view-num">${i + 1}</span>
            ${item.image
                ? `<img class="rank-view-img${item.round ? " round" : ""}" src="${esc(item.image)}" alt="">`
                : `<div class="rank-view-img rank-result-placeholder${item.round ? " round" : ""}"></div>`}
            <div class="rank-view-text">
                <span class="rank-view-name">${esc(item.name)}</span>
                ${item.subtitle ? `<span class="rank-view-sub">${esc(item.subtitle)}</span>` : ""}
            </div>
        </li>`).join("");
}
