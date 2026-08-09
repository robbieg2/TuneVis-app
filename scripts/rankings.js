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
        // Fetch extra album results up front since many will be filtered out below
        url.searchParams.set("limit", "20");

        const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${t}` } });
        if (!res.ok) throw new Error(`Search failed: ${res.status}`);
        const data = await res.json();

        const MIN_ALBUM_TRACKS = 4;

        const artists = (data?.artists?.items || []).slice(0, 8);
        // Spotify tags most singles as album_type "single", but many artists now
        // release short multi-track "album" releases too — so filter on actual
        // track count rather than trusting album_type alone.
        const albums = (data?.albums?.items || [])
            .filter(al => (al.total_tracks || 0) >= MIN_ALBUM_TRACKS)
            .slice(0, 8);

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

let searchDebounce = null;

function triggerSearch() {
    clearTimeout(searchDebounce);
    const q = searchInput.value.trim();
    if (!q) return;
    doSearch(q);
}

if (searchBtn) searchBtn.addEventListener("click", triggerSearch);
if (searchInput) {
    searchInput.addEventListener("keydown", e => {
        if (e.key === "Enter") triggerSearch();
    });

    searchInput.addEventListener("input", () => {
        const q = searchInput.value.trim();
        clearTimeout(searchDebounce);

        if (q.length < 2) {
            resultsEl.innerHTML = "";
            return;
        }

        searchDebounce = setTimeout(() => doSearch(q), 300);
    });
}
