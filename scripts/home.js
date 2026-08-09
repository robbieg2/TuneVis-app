// home.js
import { getSpotifyToken, saveToRecent, getRecent } from "./auth.js";

const LASTFM_API_KEY = "2e23f6b1b4b3345ab5e33a788a072303";
const TRENDING_CACHE_KEY = "tunevis_trending_cache";
const TRENDING_CACHE_TTL = 60 * 60 * 1000; // 1 hour

const searchInput = document.getElementById("search-input");
const searchBtn   = document.getElementById("search-btn");
const resultsDiv  = document.getElementById("search-results");
const searchWrapper = document.getElementById("search-carousel-wrapper");
const infoBtn     = document.getElementById("info-btn");

// ── Shared card renderer ─────────────────────────────────────────────────────

function buildTrackCard(track) {
  // track: Spotify track object OR { id, name, artists (string[]), image }
  const id      = track.id;
  const name    = track.name;
  const artists = Array.isArray(track.artists)
    ? track.artists.map(a => (typeof a === "string" ? a : a.name)).join(", ")
    : "";
  const image   = track.image || track.album?.images?.[0]?.url || "";

  const div = document.createElement("div");
  div.className = "track-result";
  div.innerHTML = `
    ${image ? `<img src="${image}" width="120" height="120" style="border-radius:10px;"><br/>` : ""}
    <strong>${name}</strong><br/>
    <em>${artists}</em><br/><br/>
    <iframe src="https://open.spotify.com/embed/track/${id}"
      width="300" height="80" frameborder="0"
      allowtransparency="true" allow="encrypted-media">
    </iframe>
    <br/><br/>
    <button class="features-btn">Show audio features</button>
  `;

  div.querySelector(".features-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const trackData = {
      id,
      name,
      artists: Array.isArray(track.artists)
        ? track.artists.map(a => (typeof a === "string" ? a : a.name))
        : [],
      image,
    };
    saveToRecent(trackData);
    window.location.href = `features.html?track=${encodeURIComponent(JSON.stringify(trackData))}`;
  });

  return div;
}

// ── Search ───────────────────────────────────────────────────────────────────

async function searchTracks(token, query) {
  try {
    const res = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=7`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error("Search failed");
    const data = await res.json();
    displaySearchResults(data.tracks.items);
  } catch (err) {
    console.error("Search error:", err);
    resultsDiv.innerHTML = "<p>Error searching for tracks.</p>";
  }
}

function displaySearchResults(tracks) {
  resultsDiv.innerHTML = "";
  if (!tracks?.length) {
    resultsDiv.innerHTML = "<p>No results found.</p>";
    searchWrapper.style.display = "flex";
    return;
  }
  tracks.forEach(t => resultsDiv.appendChild(buildTrackCard(t)));
  searchWrapper.style.display = "flex";
  updateCarouselButtons(resultsDiv,
    document.getElementById("scroll-left"),
    document.getElementById("scroll-right")
  );
}

// ── Trending ─────────────────────────────────────────────────────────────────

async function fetchTrendingTracks(token) {
  // Check cache first
  try {
    const cached = JSON.parse(localStorage.getItem(TRENDING_CACHE_KEY) || "null");
    if (cached && Date.now() - cached.cachedAt < TRENDING_CACHE_TTL) {
      return cached.tracks;
    }
  } catch {}

  // 1. Get Last.fm chart
  const lfUrl = new URL("https://ws.audioscrobbler.com/2.0/");
  lfUrl.searchParams.set("method", "chart.getTopTracks");
  lfUrl.searchParams.set("api_key", LASTFM_API_KEY);
  lfUrl.searchParams.set("limit", "8");
  lfUrl.searchParams.set("format", "json");

  const lfRes = await fetch(lfUrl.toString());
  const lfData = await lfRes.json();
  const lfTracks = lfData?.tracks?.track || [];

  // 2. Resolve each to Spotify (concurrently, up to 4 at a time)
  const resolved = [];
  const queue = lfTracks.slice(0, 8);
  const concurrency = 4;
  let idx = 0;

  async function worker() {
    while (idx < queue.length) {
      const t = queue[idx++];
      try {
        const q = `track:"${t.name}" artist:"${t.artist?.name || ""}"`;
        const res = await fetch(
          `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=1`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json();
        const item = data?.tracks?.items?.[0];
        if (item) resolved.push(item);
      } catch {}
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  // Cache result
  try {
    localStorage.setItem(TRENDING_CACHE_KEY, JSON.stringify({ tracks: resolved, cachedAt: Date.now() }));
  } catch {}

  return resolved;
}

async function loadTrending(token) {
  const loadingEl = document.getElementById("trending-loading");
  const wrapper   = document.getElementById("trending-carousel-wrapper");
  const carousel  = document.getElementById("trending-results");

  try {
    const tracks = await fetchTrendingTracks(token);
    if (loadingEl) loadingEl.style.display = "none";

    if (!tracks.length) {
      if (loadingEl) { loadingEl.textContent = "Couldn't load trending tracks."; loadingEl.style.display = "block"; }
      return;
    }

    tracks.forEach(t => carousel.appendChild(buildTrackCard(t)));
    wrapper.style.display = "flex";

    updateCarouselButtons(carousel,
      document.getElementById("trend-scroll-left"),
      document.getElementById("trend-scroll-right")
    );
  } catch (err) {
    console.error("Trending load error:", err);
    if (loadingEl) { loadingEl.textContent = "Couldn't load trending tracks."; loadingEl.style.display = "block"; }
  }
}

// ── Recently Viewed ──────────────────────────────────────────────────────────

function loadRecent() {
  const tracks   = getRecent();
  const emptyEl  = document.getElementById("recent-empty");
  const wrapper  = document.getElementById("recent-carousel-wrapper");
  const carousel = document.getElementById("recent-results");

  carousel.innerHTML = "";

  if (!tracks.length) {
    if (emptyEl)  emptyEl.style.display  = "block";
    if (wrapper)  wrapper.style.display  = "none";
    return;
  }

  if (emptyEl) emptyEl.style.display = "none";
  tracks.forEach(t => carousel.appendChild(buildTrackCard(t)));
  wrapper.style.display = "flex";

  updateCarouselButtons(carousel,
    document.getElementById("recent-scroll-left"),
    document.getElementById("recent-scroll-right")
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

function initTabs() {
  const tabBtns   = document.querySelectorAll(".tab-btn");
  const tabPanels = { trending: document.getElementById("tab-trending"), recent: document.getElementById("tab-recent") };

  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      tabBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const target = btn.dataset.tab;
      Object.entries(tabPanels).forEach(([key, el]) => {
        if (el) el.style.display = key === target ? "block" : "none";
      });

      if (target === "recent") loadRecent();
    });
  });
}

// ── Carousel helpers ─────────────────────────────────────────────────────────

function updateCarouselButtons(carousel, leftBtn, rightBtn) {
  if (!leftBtn || !rightBtn) return;
  const update = () => {
    leftBtn.style.display  = carousel.scrollLeft <= 0 ? "none" : "block";
    rightBtn.style.display = carousel.clientWidth >= carousel.scrollWidth - 1 ? "none" : "block";
  };
  update();
  carousel.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  leftBtn.addEventListener("click",  () => carousel.scrollBy({ left: -320, behavior: "smooth" }));
  rightBtn.addEventListener("click", () => carousel.scrollBy({ left:  320, behavior: "smooth" }));
}

// ── Info modal ───────────────────────────────────────────────────────────────

function initInfoModal() {
  infoBtn.addEventListener("click", () => {
    let modal = document.getElementById("site-info-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "site-info-modal";
      modal.className = "site-info-modal";
      modal.innerHTML = `
        <div class="site-info-card">
          <button class="site-info-close" aria-label="Close">X</button>
          <h2>About TuneVis</h2>
          <p>TuneVis compares songs using audio features such as energy, danceability and acousticness. It then ranks similar songs based on the scores of these features.</p>
          <p>Recommendations are filtered either by 'similar songs' or 'similar artists' based on availability, but unfortunately not all songs are available to view.</p>
          <p>Explore recommendations, compare similarity scores, and visualise how tracks relate to each other.</p>
          <p>TuneVis plays tracks through Spotify's embedded player. If playback doesn't work, log into Spotify in another tab or in the desktop app.</p>
        </div>
      `;
      document.body.appendChild(modal);
      modal.querySelector(".site-info-close").addEventListener("click", () => modal.classList.remove("open"));
      modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("open"); });
    }
    modal.classList.add("open");
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  let token;
  try {
    token = await getSpotifyToken();
  } catch (err) {
    console.error("Could not obtain Spotify token:", err);
    resultsDiv.innerHTML = "<p>Unable to connect to Spotify. Please try again later.</p>";
    searchWrapper.style.display = "flex";
    return;
  }

  let searchDebounce = null;

  searchBtn.addEventListener("click", () => {
    clearTimeout(searchDebounce);
    const q = searchInput.value.trim();
    if (q) searchTracks(token, q);
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(searchDebounce);
      const q = searchInput.value.trim();
      if (q) searchTracks(token, q);
    }
  });

  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim();
    clearTimeout(searchDebounce);

    if (q.length < 2) {
      searchWrapper.style.display = "none";
      resultsDiv.innerHTML = "";
      return;
    }

    searchDebounce = setTimeout(() => searchTracks(token, q), 300);
  });

  initTabs();
  initInfoModal();
  loadTrending(token);
}

init();
