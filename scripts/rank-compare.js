// rank-compare.js — comparing a friend's ranking with your own of the same album /
// artist (rank.html, rank-general.html, opened from social with from=<id>). When you've
// saved a ranking of the same kind and source (the newest one counts), the finished-list
// view gets a "Compare with yours" button. Compare mode shows a summary (how much you
// agree, what you have in common, both star ratings) and the two lists, each item marked
// with where the other person put it. Side by side on wide screens; on phones a switch
// shows one list at a time.
//
// Both lists come from the saved rows' `items` snapshots, so no Spotify calls are needed.
import { esc } from "./auth.js";
import { listRankings, rankingUrl } from "./saved-rankings.js";
import { starsHtml, formatRating } from "./star-rating.js";
import { sameSubject, albumKey } from "./album-editions.js";

let setUpFor = null;

// Opened from "See friends' rankings" (compare=1): go straight into compare mode. Read
// now, before the page tidies its URL.
const autoCompare = new URLSearchParams(window.location.search).get("compare") === "1";

// Two editions of an album have different track ids, so their lists are compared by
// track name instead (albumKey also drops "- 2011 Remaster" and the like).
function byTrackName(r) {
    const key = item => `name:${albumKey(item?.name)}`;
    const itemOf = id => (r.items || []).find(i => i.id === id);
    return {
        ...r,
        item_ids: (r.item_ids || []).map(id => key(itemOf(id) || { name: id })),
        items: (r.items || []).map(i => ({ ...i, id: key(i) })),
    };
}

// 0–100: for every item in either list, full marks when both put it in the same place,
// less the further apart, nothing when only one of you ranked it.
export function agreement(theirIds, myIds) {
    const union = [...new Set([...theirIds, ...myIds])];
    if (!union.length) return null;
    const n = Math.max(theirIds.length, myIds.length);
    let total = 0;
    for (const id of union) {
        const a = theirIds.indexOf(id), b = myIds.indexOf(id);
        if (a >= 0 && b >= 0) total += n > 1 ? 1 - Math.abs(a - b) / (n - 1) : 1;
    }
    return Math.round((total / union.length) * 100);
}

function facts(theirs, mine, username) {
    const t = theirs.item_ids || [], m = mine.item_ids || [];
    const name = id => (theirs.items || []).concat(mine.items || []).find(i => i.id === id)?.name || "one";
    const shared = t.filter(id => m.includes(id));
    const out = [];
    if (t.length && m.length) {
        out.push(`${shared.length} of ${Math.max(t.length, m.length)} in both lists`);
        if (t[0] && t[0] === m[0]) out.push(`You both have <strong>${esc(name(t[0]))}</strong> at #1`);
        else if (t[0] && m[0]) out.push(`Your #1s: <strong>${esc(name(m[0]))}</strong> (you) and <strong>${esc(name(t[0]))}</strong> (@${esc(username)})`);
        let biggest = null;
        for (const id of shared) {
            const gap = Math.abs(t.indexOf(id) - m.indexOf(id));
            if (gap >= 2 && (!biggest || gap > biggest.gap)) biggest = { id, gap };
        }
        if (biggest) {
            out.push(`Biggest difference: <strong>${esc(name(biggest.id))}</strong>, #${t.indexOf(biggest.id) + 1} for @${esc(username)} and #${m.indexOf(biggest.id) + 1} for you`);
        }
    }
    return out;
}

const starsLine = r => (r.kind === "album" && r.rating != null
    ? `${starsHtml(Number(r.rating), { size: 15 })}<span>${formatRating(Number(r.rating))}</span>`
    : `<span class="compare-unrated">Not rated</span>`);

// One list, each item with a badge for where the other person put it.
function columnHtml(r, other, { heading, whoOther, link }) {
    const ids = r.item_ids || [];
    const otherIds = other.item_ids || [];
    const items = ids.map(id => (r.items || []).find(i => i.id === id) || { id, name: "Unknown" });
    const rows = items.map((item, i) => {
        const at = otherIds.indexOf(item.id);
        const gap = at < 0 ? null : Math.abs(at - i);
        const cls = at < 0 ? "none" : gap === 0 ? "same" : gap <= 2 ? "close" : "far";
        const badge = at < 0 ? `Not in ${whoOther === "You" ? "yours" : "theirs"}` : `${esc(whoOther)}: #${at + 1}`;
        return `<li class="compare-row" data-item="${esc(item.id)}">
            <span class="rank-view-num">${i + 1}</span>
            ${item.image ? `<img class="compare-img" src="${esc(item.image)}" alt="" loading="lazy">` : `<span class="compare-img"></span>`}
            <span class="compare-text"><span class="compare-name">${esc(item.name)}</span>${item.subtitle ? `<span class="compare-sub">${esc(item.subtitle)}</span>` : ""}</span>
            <span class="compare-badge ${cls}">${badge}</span>
        </li>`;
    }).join("");
    return `
        <div class="compare-col-head">
            <h3>${heading}</h3>
            ${link ? `<a class="social-link" href="${esc(link)}">Open &#8250;</a>` : ""}
        </div>
        <div class="compare-stars">${starsLine(r)}</div>
        ${rows ? `<ol class="compare-list">${rows}</ol>` : `<p class="tab-empty">Nothing ranked yet${r.kind === "album" ? ", only rated" : ""}.</p>`}`;
}

// Adds the button and the compare panel to the view, if you've ranked the same thing.
// theirs: the friend's saved ranking row (with items); username: theirs.
export async function setupCompare(viewEl, theirs, username) {
    if (!viewEl || !theirs || setUpFor === theirs.id) return;
    setUpFor = theirs.id;
    let mine = null;
    for (const r of (await listRankings().catch(() => null)) || []) {   // newest first
        if (r.kind === theirs.kind && await sameSubject(r, theirs)) { mine = r; break; }
    }
    if (!mine || setUpFor !== theirs.id) return;
    const mineLink = rankingUrl(mine);   // before any re-keying below
    // Different editions of one album: line the tracks up by name.
    if (mine.kind === "album" && mine.source_id !== theirs.source_id) {
        mine = byTrackName(mine);
        theirs = byTrackName(theirs);
    }

    const listEl = viewEl.querySelector("#rank-view-list");
    const actions = viewEl.querySelector(".rank-view-actions");
    const panel = document.createElement("section");
    panel.className = "rank-compare";
    panel.hidden = true;
    const score = agreement(theirs.item_ids || [], mine.item_ids || []);
    const who = `@${esc(username || "friend")}`;
    panel.innerHTML = `
        <div class="compare-summary">
            ${score !== null && (theirs.item_ids?.length && mine.item_ids?.length)
                ? `<div class="compare-score"><span class="compare-score-num">${score}%</span><span class="compare-score-label">in agreement</span></div>`
                : ""}
            <ul class="compare-facts">${facts(theirs, mine, username || "friend").map(f => `<li>${f}</li>`).join("")}
                ${theirs.kind === "album" ? `<li>Stars: ${who} ${theirs.rating != null ? formatRating(Number(theirs.rating)) : "not rated"} · you ${mine.rating != null ? formatRating(Number(mine.rating)) : "not rated"}</li>` : ""}
            </ul>
        </div>
        <div class="compare-switch" role="group" aria-label="Which list to show">
            <button type="button" class="tab-btn active" data-show="theirs" aria-pressed="true">${who}</button>
            <button type="button" class="tab-btn" data-show="mine" aria-pressed="false">You</button>
        </div>
        <div class="compare-cols" data-show="theirs">
            <div class="compare-col theirs">${columnHtml(theirs, mine, { heading: who, whoOther: "You" })}</div>
            <div class="compare-col mine">${columnHtml(mine, theirs, { heading: "You", whoOther: `@${username || "friend"}`, link: mineLink })}</div>
        </div>`;
    listEl.after(panel);

    // You already have one: "Rank it yourself" becomes a link to yours.
    const own = actions.querySelector(".rank-own-btn");
    if (own) {
        own.href = mineLink;
        const ownBtn = own.querySelector("button");
        if (ownBtn) ownBtn.textContent = "Open your ranking";
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "secondary-btn rank-compare-btn";
    btn.textContent = "Compare with yours";
    actions.prepend(btn);
    btn.addEventListener("click", () => {
        const on = panel.hidden;
        panel.hidden = !on;
        listEl.hidden = on;
        btn.textContent = on ? "Close comparison" : "Compare with yours";
        btn.classList.toggle("active", on);
        viewEl.classList.toggle("comparing", on);   // wider, so the lists fit side by side
        if (on) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    if (autoCompare) btn.click();

    // Phones: switch between the two lists.
    const cols = panel.querySelector(".compare-cols");
    panel.querySelector(".compare-switch").addEventListener("click", e => {
        const b = e.target.closest("[data-show]");
        if (!b) return;
        cols.dataset.show = b.dataset.show;
        panel.querySelectorAll(".compare-switch [data-show]").forEach(x => {
            const on = x === b;
            x.classList.toggle("active", on);
            x.setAttribute("aria-pressed", String(on));
        });
    });

    // Side by side: pointing at an item lights it up in both lists.
    panel.addEventListener("mouseover", e => {
        const row = e.target.closest(".compare-row");
        panel.querySelectorAll(".compare-row.lit").forEach(r => r.classList.remove("lit"));
        if (row) panel.querySelectorAll(`.compare-row[data-item="${CSS.escape(row.dataset.item)}"]`).forEach(r => r.classList.add("lit"));
    });
    panel.addEventListener("mouseleave", () => panel.querySelectorAll(".compare-row.lit").forEach(r => r.classList.remove("lit")));
}
