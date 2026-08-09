// rankings.js — search for an artist or album, hand off to rank.html
import { getSpotifyToken } from "./auth.js";

const backBtn = document.getElementById("back-btn");
const searchInput = document.getElementById("rankings-search-input");
const searchBtn = document.getElementById("rankings-search-btn");
const resultsEl = document.getElementById("rankings-results");

if (backBtn) backBtn.addEventListener("click", () => history.back());

let token = null;

async function ensureToken() {
    if (token) return token;
    token = await getSpotifyToken();
    return token;
}

function resultCard({ type, id, name, subtitle, image }) {
    const card = document.createElement("div");
    card.className = "rank-result-card";
    card.innerHTML = `
        ${image ? `<img class="rank-result-img ${type === "artist" ? "round" : ""}" src="${image}" alt="">` : `<div class="rank-result-img rank-result-placeholder ${type === "artist" ? "round" : ""}"></div>`}
        <div class="rank-result-meta">
            <span class="rank-result-name">${name}</span>
            <span class="rank-result-sub">${subtitle}</span>
        </div>
    `;
    card.addEventListener("click", () => {
        window.location.href = `rank.html?type=${type}&id=${encodeURIComponent(id)}`;
    });
    return card;
}

async function doSearch(query) {
    resultsEl.innerHTML = `<p class="tab-loading">Searching…</p>`;

    try {
        const t = await ensureToken();
        const url = new URL("https://api.spotify.com/v1/search");
        url.searchParams.set("q", query);
        url.searchParams.set("type", "artist,album");
        url.searchParams.set("limit", "8");

        const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${t}` } });
        if (!res.ok) throw new Error(`Search failed: ${res.status}`);
        const data = await res.json();

        const artists = data?.artists?.items || [];
        const albums = data?.albums?.items || [];

        resultsEl.innerHTML = "";

        if (!artists.length && !albums.length) {
            resultsEl.innerHTML = `<p class="tab-empty">No artists or albums found for "${query}"</p>`;
            return;
        }

        if (artists.length) {
            const group = document.createElement("div");
            group.className = "rank-result-group";
            group.innerHTML = `<h3 class="rank-result-group-title">Artists</h3>`;
            const grid = document.createElement("div");
            grid.className = "rank-result-grid";
            artists.forEach(a => {
                grid.appendChild(resultCard({
                    type: "artist",
                    id: a.id,
                    name: a.name,
                    subtitle: "Artist",
                    image: a.images?.[0]?.url || "",
                }));
            });
            group.appendChild(grid);
            resultsEl.appendChild(group);
        }

        if (albums.length) {
            const group = document.createElement("div");
            group.className = "rank-result-group";
            group.innerHTML = `<h3 class="rank-result-group-title">Albums</h3>`;
            const grid = document.createElement("div");
            grid.className = "rank-result-grid";
            albums.forEach(al => {
                grid.appendChild(resultCard({
                    type: "album",
                    id: al.id,
                    name: al.name,
                    subtitle: (al.artists || []).map(a => a.name).join(", "),
                    image: al.images?.[0]?.url || "",
                }));
            });
            group.appendChild(grid);
            resultsEl.appendChild(group);
        }
    } catch (err) {
        console.error(err);
        resultsEl.innerHTML = `<p class="tab-empty">Something went wrong searching. Try again.</p>`;
    }
}

function triggerSearch() {
    const q = searchInput.value.trim();
    if (!q) return;
    doSearch(q);
}

if (searchBtn) searchBtn.addEventListener("click", triggerSearch);
if (searchInput) {
    searchInput.addEventListener("keydown", e => {
        if (e.key === "Enter") triggerSearch();
    });
}
