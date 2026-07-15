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
    const artists = (track.artists || []).join(", ");

    trackInfo.innerHTML = `
        <div class="seed-header">
            ${track.image ? `<img class="seed-cover" src="${track.image}" alt="Album cover">` : ""}

            <div class="seed-meta">
                <h1 class="seed-title">${track.name}</h1>
                <p class="seed-artists">${artists}</p>

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
	const tip = document.getElementById("chart-tip");
	
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
	if (tip) tip.style.display = "none";

	if (msgCard) msgCard.style.display = "flex";
    if (noFeat) {
        noFeat.style.display = "block";
        noFeat.innerHTML = `
            <div>
                <h3>No audio features available for this track</h3>
                <p style="opacity:0.85;">Try another song</p>
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
	const tip = document.getElementById("chart-tip");
	
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
	if (tip) tip.style.display = "flex";
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
		card.innerHTML = `
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
	const items = pool.slice();
	const k = 0.7;
	
	const picked = [];
	while (picked.length < n && items.length) {
		const weights = items.map(r => Math.pow(Math.max(0, r.score || 0), k) + 0.01);
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

// Main function
async function init() {
    if (backBtn) backBtn.addEventListener("click", () => (window.location.href = "home.html"));

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
		
        const seedFeatures = await getTrackFeaturesFromReccoBeats(track.id);

        if (!seedFeatures) {
            hideVisualSections();
            return;
        }

        showVisualSections();
		
        const seedMeta = await spotifyFetch(token, `https://api.spotify.com/v1/tracks/${track.id}`);
        const market = getSeedMarketFromSeedMeta(seedMeta);

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
		candidateIds = normalizeSpotifyIds(candidateIds);

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

                const t = metaMap.get(id);
                return {
                    id,
                    features: f,
                    score: similarityScore(seedFeatures, f),
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


	