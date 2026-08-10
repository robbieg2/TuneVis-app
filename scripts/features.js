// features.js
import {
    getManyFeaturesFromReccoBeats,
    getTrackFeaturesFromReccoBeats,
    similarityScore,
    spotifyFetch,
    spotifyResolveManyTrackIds,
    lastfmGetSimilarTracks,
	lastfmGetSimilarArtists,
	lastfmGetArtistTopTracks,
} from "./features-data.js";

import {
	drawMultiRadarChart,
	drawSimilarityBarChart,
	drawSimilarityScatter
} from "./features-charts.js";

import { getSpotifyToken, saveToRecent } from "./auth.js";

const trackInfo = document.getElementById("track-info");
const backBtn = document.getElementById("back-btn");

// Loading wheel while page renders
function setLoading(on, sub = "") {
	const overlay = document.getElementById("page-loading");
	const subEl = document.getElementById("loading-sub");
	if (!overlay) return;
	
	if (subEl) subEl.textContent = sub || "";
	overlay.style.display = on ? "flex" : "none";
}

// Track header with embed	
function renderTrackHeader(track) {
    const artistSpans = (track.artists || [])
        .map(a => `<span class="artist-link" data-artist-name="${a}">${a}</span>`)
        .join(", ");

    trackInfo.innerHTML = `
        <div class="seed-header">
            ${track.image ? `<img class="seed-cover" src="${track.image}" alt="Album cover">` : ""}

            <div class="seed-meta">
                <h1 class="seed-title">${track.name}</h1>
                <p class="seed-artists">${artistSpans}</p>

                <iframe
                    class="seed-embed"
                    src="https://open.spotify.com/embed/track/${track.id}"
                    frameborder="0"
                    allowtransparency="true"
                    allow="encrypted-media">
                </iframe>
            </div>
        </div>
    `;
}


// Tooltip helpers
function tooltipEl() {
	let el = document.getElementById("chart-tooltip");
	if(!el) {
		el = document.createElement("div");
		el.id = "chart-tooltip";
		document.body.appendChild(el);
	}
	
	el.style.position = "fixed";
	el.style.zIndex = "9999";
	if (!el.style.display) el.style.display = "none";
	return el;
}

function showTooltip(html) {
	const el = tooltipEl();
	el.innerHTML = html;
	el.style.display = "block";
}

function hideTooltip() {
	const el = document.getElementById("chart-tooltip");
	if (!el) return;
	el.style.display = "none";
	el.innerHTML = "";
}

function positionTooltipAtElement(anchorEl) {
	const el = tooltipEl();
	if (!anchorEl) return;
	
	const rect = anchorEl.getBoundingClientRect();
	
	const pad = 10;
	const vw = window.innerWidth;
	const vh = window.innerHeight;

	const tw = el.offsetWidth || 280;
	const th = el.offsetHeight || 140;

	let x = rect.right + pad;
	let y = rect.top + rect.height / 2 - th / 2;

	if (x + tw + pad > vw) x = rect.left - tw - pad;

	x = Math.max(pad, Math.min(vw - tw - pad, x));
	y = Math.max(pad, Math.min(vh - th - pad, y));

	el.style.left = `${x}px`;
	el.style.top = `${y}px`;
	el.style.transform = "none";
}

// Tooltip explaining similarity
function attachSimilarityHelpPopover() {
	const btn = document.getElementById("sim-help");
	if (!btn) return;
	
	const html = `
		<div class="tt-title">How similarity is calculated</div>

		<div class="tt-sub">
			<p>
				The seed track is compared to each recommendation using these audio features:
				<b>danceability</b>, <b>energy</b>, <b>valence</b>, <b>speechiness</b>,
				<b>acousticness</b>, and <b>instrumentalness</b>
			</p>

			<p>
				For each feature the distance between the two values is measured (0–1).
				The closer they are, the higher the similarity
				Those distances are then averaged to give an overall score
			</p>

			<p>
				<b>Similarity Score</b> = <b>100%</b> means “very similar features” and
				<b>0%</b> means “very different”
			</p>
		</div>
	`;
	
	btn.addEventListener("mouseenter", (e) => {
		showTooltip(html);
		positionTooltipAtElement(btn);
	});
	
	btn.addEventListener("mouseleave", () => hideTooltip());
}

// Hide visualisations when no audio features are available
function hideVisualSections() {
    const simRadar = document.getElementById("sim-radar");
    const simBar = document.getElementById("sim-bar");
    const simScatter = document.getElementById("sim-scatter");
	const msgCard = document.getElementById("card-message");
    const noFeat = document.getElementById("no-features");

    const radarCard = document.getElementById("card-radar");
    const barCard = document.getElementById("card-bar");
    const scatterCard = document.getElementById("card-scatter");
    const recsCard = document.getElementById("recs-card");

    if (simRadar) simRadar.innerHTML = "";
    if (simBar) simBar.innerHTML = "";
    if (simScatter) simScatter.innerHTML = "";

    if (recsCard) recsCard.style.display = "none";
    if (scatterCard) scatterCard.style.display = "none";
    if (barCard) barCard.style.display = "none";
    if (radarCard) radarCard.style.display = "none";

	if (msgCard) msgCard.style.display = "flex";
    if (noFeat) {
        noFeat.style.display = "block";
        noFeat.innerHTML = `
            <div>
                <h3>Audio features not yet available</h3>
                <p style="opacity:0.85;">This track may have been released too recently to be indexed.<br>Check back soon, or try a different song in the meantime.</p>
            </div>
        `;
    }
}

// Show visualisations when audio features are available
function showVisualSections() {
    const radarCard = document.getElementById("card-radar");
    const barCard = document.getElementById("card-bar");
    const scatterCard = document.getElementById("card-scatter");
    const recsCard = document.getElementById("recs-card");
	const msgCard = document.getElementById("card-message");
	const noFeat = document.getElementById("no-features");

    if (recsCard) recsCard.style.display = "block";
    if (scatterCard) scatterCard.style.display = "block";
    if (barCard) barCard.style.display = "block";
    if (radarCard) {
		radarCard.style.display = "block";
		radarCard.classList.remove("centered-message");
	}
	
	if (msgCard) msgCard.style.display = "none";
	if (noFeat) {
		noFeat.style.display = "none";
		noFeat.innerHTML = "";
	}
}

// Show recommendation embeds
function renderRecommendations(items = [], { subtitle } = {}) {
    const container = document.getElementById("recommendations");
    if (!container) return;
	
	const rows = (items || [])
		.map((x) => (typeof x === "string" ? { id: x } : x))
		.filter((x) => x && x.id);
		
	if (rows.length === 0) {
		container.innerHTML = `
			<div style="display:flex; align-items:baseline; justify-content:space-between; gap:12px;">
			<h3 style="margin:0;">Recommended Tracks</h3>
				${subtitle ? `<span class="muted" style="font-size:12px;">${subtitle}</span>` : ""}
			</div>
			<p class="muted" style="margin-top:10px;">No recommendations available</p>
		`;
		return;
	}
	
	container.innerHTML = `
		<div style="display:flex; align-items:baseline; justify-content:space-between; gap:12px;">
			<div style="display:flex; align-items:baseline; gap:10px;">
				<h3 style="margin:0;">Recommended Tracks</h3>
				${subtitle ? `<span class="muted" style="font-size:12px;">${subtitle}</span>` : ""}
			</div>
		
			<button id="shuffle-recs" class="shuffle-btn" type="button">Shuffle Recommendations</button>
		</div>
		
		<div class="carousel-wrapper">
			<button class="scroll-btn" id="recs-scroll-left" aria-label="Scroll left"><</button>
			<div class="carousel" id="recs-carousel"></div>
			<button class="scroll-btn" id="recs-scroll-right" aria-label="Scroll right">></button>
		</div>
	`;
	
	const carousel = document.getElementById("recs-carousel");
	if (!carousel) return;

    rows.forEach((r) => {
		const id = r.id;
		
        const card = document.createElement("div");
		card.className = "rec-card";
		card.dataset.trackId = id;
		const trackMeta = r.track || null;
		const scorePct = r.score != null ? Math.round(r.score * 100) : null;
		card.innerHTML = `
			${scorePct != null ? `<div class="score-badge">${scorePct}% match</div>` : ""}
			<iframe
				src="https://open.spotify.com/embed/track/${id}"
				width="100%"
				height="153"
				frameborder="0"
				allow="encrypted-media">
			</iframe>
			${trackMeta ? `<button class="features-btn analyse-rec-btn" style="margin-top:8px;width:100%;">Analyse this track</button>` : ""}
		`;

		if (trackMeta) {
			card.querySelector(".analyse-rec-btn")?.addEventListener("click", (e) => {
				e.stopPropagation();
				saveToRecent(trackMeta);
				window.location.href = `features.html?track=${encodeURIComponent(JSON.stringify(trackMeta))}`;
			});
		}
	
		card.addEventListener("mouseenter", (e) => {
			window.dispatchEvent(new CustomEvent("rec-hover", { detail: { trackId: id } }));
		}); 
		
		card.addEventListener("mouseleave", () => {
			window.dispatchEvent(new CustomEvent("rec-hover", { detail: { trackId: null } }));
		});	
		
		carousel.appendChild(card);
	});
	
	const shuffleBtn = document.getElementById("shuffle-recs");
	if (shuffleBtn) {
		shuffleBtn.onclick = () => {
			hideTooltip();
			window.dispatchEvent(new CustomEvent("rec-hover", {detail: { trackId: null } }));
			renderShuffleView();
		};
	}
        
	const leftBtn = document.getElementById("recs-scroll-left");
	const rightBtn = document.getElementById("recs-scroll-right");
	
	const scrollByAmount = () => Math.max(260, Math.floor(carousel.clientWidth * 0.85));
	
	if (leftBtn) {
		leftBtn.addEventListener("click", () => {
			carousel.scrollBy({ left: -scrollByAmount(), behavior: "smooth" });
		});
	}
	if (rightBtn) {
		rightBtn.addEventListener("click", () => {
			carousel.scrollBy({ left: scrollByAmount(), behavior: "smooth" });
		});
	}
}

// Functions to clean/aid API data
function normalizeSpotifyIds(list) {
	return (list || [])
		.map(x => {
		if (typeof x === "string") return x;
		if (x && typeof x === "object") return x.id || x.spotifyId || null;
		return null;
	})
	.filter(id => typeof id === "string" && id.length > 0);
}

function getSeedMarketFromSeedMeta(seedMeta) {
    return seedMeta?.available_markets?.[0] || "GB";
}

function shuffleInPlace(arr) {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

function weightedSample(pool, n) {
	// Only draw from tracks scoring above a minimum threshold;
	// fall back to full pool if there aren't enough qualifying tracks.
	const MIN_SCORE = 0.38;
	let eligible = pool.filter(r => (r.score || 0) >= MIN_SCORE);
	if (eligible.length < n) eligible = pool.slice();
	const items = eligible.slice();
	const k = 1.4; // sharper weighting — high scorers much more likely than low scorers

	const picked = [];
	while (picked.length < n && items.length) {
		const weights = items.map(r => Math.pow(Math.max(0, r.score || 0), k) + 0.001);
		const total = weights.reduce((a, b) => a + b, 0);
		let roll = Math.random() * total;
		
		let idx = 0;
		for (; idx < items.length; idx++) {
			roll -= weights[idx];
			if (roll <= 0) break;
		}
		
		const [chosen] = items.splice(Math.min(idx, items.length - 1), 1);
		picked.push(chosen);
	}
	return picked;
}

window.__recentShown = window.__recentShown || [];
const RECENT_LIMIT = 10;

function renderShuffleView() {
	const pool = Array.isArray(window.__recPool) ? window.__recPool : [];
	const seed = window.__seedFeatures;
	const seedTrack = window.__seedTrack;
	if (!pool.length || !seed || !seedTrack) return;
	
	const scatterRows = shuffleInPlace(pool.slice()).slice(0, 20);
	
	const recent = Array.isArray(window.__recentShown) ? window.__recentShown : [];
	
	let freshPool = pool.filter(r => !recent.includes(r.id));
	if (freshPool.length < 10) {
		freshPool = pool.slice();
	}
	
	let top10 = weightedSample(freshPool, 10).sort((a, b) => (b.score || 0) - (a.score || 0));
	
	const nextRecent = [...top10.map(r => r.id), ...recent]
		.filter((v, i, arr) => arr.indexOf(v) === i)
		.slice(0, RECENT_LIMIT);
		
	window.__recentShown = nextRecent;
	
	const radarSeries = [
		{ label: `Seed: ${seedTrack.name}`, id: seedTrack.id, features: seed, isSeed: true },
		...top10.slice(0, 4).map(r => ({
			label: r.track?.name || "Track",
			id: r.id,
			features: r.features,
			isSeed: false,
		})),
	];

	renderRecommendations(top10, { subtitle: window.__recModeSubtitle });
	drawMultiRadarChart(radarSeries);
	drawSimilarityBarChart(top10);
	drawSimilarityScatter(seed, scatterRows);
}	

// Make artist names on the track header clickable — opens a top-tracks modal
function attachArtistLinks(spotifyArtists, token) {
    const links = trackInfo ? trackInfo.querySelectorAll(".artist-link") : [];
    links.forEach(link => {
        const name = link.dataset.artistName;
        const artist = spotifyArtists.find(a => a.name === name);
        if (!artist) return;
        link.addEventListener("click", () => openArtistModal(artist.id, artist.name, token));
    });
}

async function openArtistModal(artistId, artistName, token) {
    // Remove any existing artist modal
    document.getElementById("artist-modal")?.remove();

    const modal = document.createElement("div");
    modal.id = "artist-modal";
    modal.className = "site-info-modal open";
    modal.innerHTML = `
        <div class="site-info-card artist-modal-card">
            <button class="site-info-close" aria-label="Close">X</button>
            <h2 class="artist-modal-name">${artistName}</h2>
            <p class="muted artist-modal-sub">Top Tracks</p>
            <div class="artist-tracks-list" id="artist-tracks-list">
                <p class="tab-loading">Loading…</p>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Captured directly rather than re-queried by id after the await below —
    // if the user clicks a second artist before this fetch resolves, a stale
    // response must not be able to write into whatever modal is now open.
    const listEl = modal.querySelector("#artist-tracks-list");

    modal.querySelector(".site-info-close").addEventListener("click", () => modal.remove());
    modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });

    try {
        const data = await spotifyFetch(token, `https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=GB`);
        // This modal may have been closed/replaced while the fetch was in flight.
        if (!document.body.contains(modal)) return;

        const tracks = (data?.tracks || []).slice(0, 8);
        const list = listEl;
        if (!list) return;

        if (!tracks.length) {
            list.innerHTML = `<p class="muted">No top tracks found.</p>`;
            return;
        }

        list.innerHTML = "";
        tracks.forEach(t => {
            const trackMeta = {
                id: t.id,
                name: t.name,
                artists: (t.artists || []).map(a => a.name),
                image: t.album?.images?.[0]?.url || "",
            };
            const item = document.createElement("div");
            item.className = "artist-track-item";
            item.innerHTML = `
                ${trackMeta.image ? `<img class="artist-track-img" src="${trackMeta.image}" alt="Album art">` : ""}
                <div class="artist-track-info">
                    <span class="artist-track-name">${t.name}</span>
                    <span class="artist-track-album">${t.album?.name || ""}</span>
                </div>
                <button class="features-btn artist-analyse-btn">Analyse</button>
            `;
            item.querySelector(".artist-analyse-btn").addEventListener("click", () => {
                saveToRecent(trackMeta);
                window.location.href = `features.html?track=${encodeURIComponent(JSON.stringify(trackMeta))}`;
            });
            list.appendChild(item);
        });
    } catch (err) {
        if (!document.body.contains(modal)) return;
        if (listEl) listEl.innerHTML = `<p class="muted">Could not load tracks.</p>`;
    }
}

// Try the seed track's ID first; if ReccoBeats has no data, search Spotify
// for alternate versions (single vs album vs remaster) and try each in turn.
async function findSeedFeaturesWithFallback(token, track) {
    const primary = await getTrackFeaturesFromReccoBeats(track.id);
    if (primary) return { features: primary, isAlternate: false };

    const artistName = Array.isArray(track.artists) ? (track.artists[0] || "") : (track.artists || "");

    // Two search passes: strict (quoted) first, then relaxed (no quotes).
    // The relaxed pass catches older catalog tracks that strict matching misses.
    const queries = [
        `track:"${track.name}" artist:"${artistName}"`,
        `${track.name} ${artistName}`,
    ];

    const seenIds = new Set([track.id]);
    const altIds = [];

    for (const q of queries) {
        if (altIds.length >= 5) break;
        try {
            const searchUrl = new URL("https://api.spotify.com/v1/search");
            searchUrl.searchParams.set("type", "track");
            searchUrl.searchParams.set("limit", "5");
            searchUrl.searchParams.set("q", q);
            const data = await spotifyFetch(token, searchUrl.toString());
            for (const t of (data?.tracks?.items || [])) {
                if (t.id && !seenIds.has(t.id)) {
                    seenIds.add(t.id);
                    altIds.push(t.id);
                }
                if (altIds.length >= 5) break;
            }
        } catch {}
    }

    for (const id of altIds) {
        const alt = await getTrackFeaturesFromReccoBeats(id);
        if (alt) return { features: alt, isAlternate: true };
    }

    return null;
}

// Main function
async function init() {
    if (backBtn) backBtn.addEventListener("click", () => history.back());

    // Audio features help modal
    const audioHelpBtn = document.getElementById("audio-help-btn");
    if (audioHelpBtn) {
        audioHelpBtn.addEventListener("click", () => {
            let modal = document.getElementById("audio-help-modal");
            if (!modal) {
                modal = document.createElement("div");
                modal.id = "audio-help-modal";
                modal.className = "site-info-modal";
                modal.innerHTML = `
                    <div class="site-info-card audio-help-card">
                        <button class="site-info-close" aria-label="Close">X</button>
                        <h2>Audio Features Guide</h2>
                        <p class="audio-help-intro">These features are measured on a 0–1 scale unless noted.</p>
                        <div class="feature-grid">
                            <div class="feature-item">
                                <span class="feature-name">Danceability</span>
                                <p>How suitable a track is for dancing. Based on tempo, rhythm stability, beat strength and regularity. Higher = more danceable.</p>
                            </div>
                            <div class="feature-item">
                                <span class="feature-name">Energy</span>
                                <p>Perceptual intensity and activity. High energy tracks feel fast, loud and noisy (e.g. death metal). Low energy feels calm (e.g. a Bach prelude).</p>
                            </div>
                            <div class="feature-item">
                                <span class="feature-name">Valence</span>
                                <p>Musical positivity. High valence sounds happy and cheerful. Low valence sounds sad, depressed or angry.</p>
                            </div>
                            <div class="feature-item">
                                <span class="feature-name">Speechiness</span>
                                <p>Presence of spoken words. Above 0.66 = likely spoken word only. 0.33–0.66 = music and speech mixed. Below 0.33 = mostly music.</p>
                            </div>
                            <div class="feature-item">
                                <span class="feature-name">Acousticness</span>
                                <p>Confidence that the track is acoustic (non-electronic). 1.0 = high confidence the track uses no amplification or effects.</p>
                            </div>
                            <div class="feature-item">
                                <span class="feature-name">Instrumentalness</span>
                                <p>Predicts whether a track contains no vocals. Values above 0.5 are treated as instrumental. The closer to 1.0, the more confident.</p>
                            </div>
                            <div class="feature-item">
                                <span class="feature-name">Tempo</span>
                                <p>Estimated beats per minute (BPM). Unlike the other features, this is not a 0–1 scale — typical values range from ~60 to ~200 BPM.</p>
                            </div>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
                modal.querySelector(".site-info-close")
                    .addEventListener("click", () => modal.classList.remove("open"));
                modal.addEventListener("click", (e) => {
                    if (e.target === modal) modal.classList.remove("open");
                });
            }
            modal.classList.add("open");
        });
    }

    let token;
    try {
        token = await getSpotifyToken();
    } catch (err) {
        console.error("Could not obtain Spotify token:", err);
        if (trackInfo) trackInfo.innerHTML = "<p>Unable to connect to Spotify. Please try again later.</p>";
        return;
    }

    const params = new URLSearchParams(window.location.search);
    const trackParam = params.get("track");

    if (!trackParam) {
        if (trackInfo) trackInfo.innerHTML = "<p>No track provided</p>";
        return;
    }

    let track;
    try {
        track = JSON.parse(decodeURIComponent(trackParam));
    } catch {
        if (trackInfo) trackInfo.innerHTML = "<p>Invalid track data</p>";
        return;
    }

    renderTrackHeader(track);

    // Save to recently-viewed whenever a features page loads
    saveToRecent({
        id: track.id,
        name: track.name,
        artists: Array.isArray(track.artists) ? track.artists : [],
        image: track.image || "",
    });

	tooltipEl();
	attachSimilarityHelpPopover();

    try {	
		setLoading(true, "Fetching audio features...");

        const seedResult = await findSeedFeaturesWithFallback(token, track);

        if (!seedResult) {
            hideVisualSections();
            return;
        }

        const { features: seedFeatures } = seedResult;

        showVisualSections();

		
        const seedMeta = await spotifyFetch(token, `https://api.spotify.com/v1/tracks/${track.id}`);
        const market = getSeedMarketFromSeedMeta(seedMeta);

        // Wire up artist name links now that we have Spotify artist IDs
        attachArtistLinks(seedMeta?.artists || [], token);

        const seedArtistName = seedMeta?.artists?.[0]?.name || track.artists?.[0] || "";
        const seedTrackName = seedMeta?.name || track.name || "";

        const LASTFM_API_KEY = "2e23f6b1b4b3345ab5e33a788a072303";
		
		let recMode = "similar tracks";
		
        let similarPairs = await lastfmGetSimilarTracks({
            apiKey: LASTFM_API_KEY,
            artist: seedArtistName,
            track: seedTrackName,
            limit: 35,
        });
		
		if (!similarPairs.length) {
			recMode = "similar artists";
			
			const similarArtists = await lastfmGetSimilarArtists({
				apiKey: LASTFM_API_KEY,
				artist: seedArtistName,
				limit: 10,
			});
			
			const topTrackPairs = [];
			for (const a of similarArtists) {
				const tops = await lastfmGetArtistTopTracks({
					apiKey: LASTFM_API_KEY,
					artist: a.name,
					limit: 3,
				});
				topTrackPairs.push(...tops);
			}
			
			similarPairs = topTrackPairs;
		}
		
		if (!similarPairs.length) {
			renderRecommendations([], {
				subtitle: "Last.fm couldn't find similar tracks for this seed",
			});
			drawMultiRadarChart([{ label:`Seed: ${track.name}`, id: track.id, features: seedFeatures, isSeed:true }]);
			drawSimilarityBarChart([]);
			drawSimilarityScatter(seedFeatures, []);
			return;
		}
		
        let candidateIds = await spotifyResolveManyTrackIds(token, similarPairs, { market, concurrency: 5 });

        // Remove the seed track from recommendations
        candidateIds = candidateIds.filter(id => id !== track.id);

        if (!candidateIds.length) {
            renderRecommendations([], {
				subtitle: "Couldn't resolve Last.fm tracks on Spotify",
			});
            drawMultiRadarChart([{ label: `Seed: ${track.name}`, id: track.id, features: seedFeatures, isSeed: true }]);
            drawSimilarityBarChart([]);
            drawSimilarityScatter(seedFeatures, []);
            return;
        }

        const recFeaturesMap = await getManyFeaturesFromReccoBeats(candidateIds);

        const meta = await spotifyFetch(token, `https://api.spotify.com/v1/tracks?ids=${candidateIds.join(",")}`);
        const metaMap = new Map((meta.tracks || []).filter(Boolean).map((t) => [t.id, t]));

        const rows = candidateIds
            .map((id) => {
                const f = recFeaturesMap.get(id);
                if (!f) return null;

                const score = similarityScore(seedFeatures, f);
                const t = metaMap.get(id);
                return {
                    id,
                    features: f,
                    score,
                    meta: t || null,
                    track: t
                        ? {
                              id: t.id,
                              name: t.name,
                              artists: (t.artists || []).map((a) => a.name),
                              image: t.album?.images?.[0]?.url || "",
                          }
                        : { id, name: "Recommended", artists: [], image: "" },
                };
            })
            .filter(Boolean);

        if (!rows.length) {
            renderRecommendations([], { subtitle: "No candidates had audio features" });
            drawMultiRadarChart([{ label: `Seed: ${track.name}`, id: track.id, features: seedFeatures, isSeed: true }]);
            drawSimilarityBarChart([]);
            drawSimilarityScatter(seedFeatures, []);
            return;
        }

        // Ranking songs for best visualisations
		const ranked = rows
			.slice()
			.sort((a, b) => b.score - a.score);
			
        const top10 = ranked.slice(0, 10);

        const radarSeries = [
            { label: `Seed: ${track.name}`, id: track.id, features: seedFeatures, isSeed: true },
            ...top10.slice(0, 4).map((r) => ({
                label: r.track?.name || "Track",
                id: r.id,
                features: r.features,
                isSeed: false,
            })),
        ];

		window.__seedTrack = track;
		window.__seedFeatures = seedFeatures;
		window.__recPool = ranked;
		window.__recModeSubtitle = recMode === "similar tracks" ? "Based on similar songs" : "Based on similar artists";
		
        renderShuffleView();
		
    } catch (err) {
        console.error(err);
    } finally {
		setLoading(false);
		hideTooltip();
	}
}

init();


	