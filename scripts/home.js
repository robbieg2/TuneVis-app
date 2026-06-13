// home.js
import { getSpotifyToken } from "./auth.js";

const searchInput = document.getElementById("search-input");
const searchBtn = document.getElementById("search-btn");
const resultsDiv = document.getElementById("search-results");
const infoBtn = document.getElementById("info-btn");
const scrollLeftBtn = document.getElementById("scroll-left");
const scrollRightBtn = document.getElementById("scroll-right");

// Search bar
async function searchTracks(token, query) {
	try {
		const res = await fetch(
			`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=7`,
			{
				headers: { Authorization: `Bearer ${token}` },
			}
		);
		if (!res.ok) throw new Error("Search failed");
		const data = await res.json();
		displaySearchResults(data.tracks.items);
	} catch (err) {
		console.error("Error searching tracks:", err);
		resultsDiv.innerHTML = `<p>Error searching for tracks.</p>`;
	}
}

// Show search results
function displaySearchResults(tracks) {
	resultsDiv.innerHTML = "";

	if (!tracks || !tracks.length) {
		resultsDiv.innerHTML = "<p>No results found.</p>";
		return;
	}

	tracks.forEach((track) => {
		const div = document.createElement("div");
		div.className = "track-result";

		div.innerHTML = `
			<img src="${track.album.images[0]?.url}" width="120" height="120" style="border-radius:10px;"><br/>
			<strong>${track.name}</strong><br/>
			<em>${track.artists.map((a) => a.name).join(", ")}</em><br><br/>
			<iframe src="https://open.spotify.com/embed/track/${track.id}"
					width="300" height="80" frameborder="0" allowtransparency="true" allow="encrypted-media">
			</iframe>
			<br/><br/>
			<button class="features-btn">Show audio features</button>
		`;

		resultsDiv.appendChild(div);

		const featuresBtn = div.querySelector(".features-btn");

		featuresBtn.addEventListener("click", (e) => {
			e.stopPropagation();

			const trackParam = encodeURIComponent(JSON.stringify({
				id: track.id,
				name: track.name,
				artists: track.artists.map(a => a.name),
				image: track.album.images?.[0]?.url || ""
			}));

			window.location.href = `features.html?track=${trackParam}`;
		});
	});

	updateScrollButtons();
}

// Scroll buttons for search results
function scrollCarouselBy(offset) {
	resultsDiv.scrollBy({ left: offset, behavior: "smooth" });
}

function updateScrollButtons() {
	if (!scrollLeftBtn || !scrollRightBtn) return;
	scrollLeftBtn.style.display = resultsDiv.scrollLeft <= 0 ? "none" : "block";
	scrollRightBtn.style.display = resultsDiv.clientWidth >= resultsDiv.scrollWidth - 1 ? "none" : "block";
}

// Main function
async function init() {
	let token;
	try {
		token = await getSpotifyToken();
	} catch (err) {
		console.error("Could not obtain Spotify token:", err);
		resultsDiv.innerHTML = `<p>Unable to connect to Spotify. Please try again later.</p>`;
		return;
	}

	searchBtn.addEventListener("click", () => {
		const query = searchInput.value.trim();
		if (query) searchTracks(token, query);
	});

	searchInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			const query = searchInput.value.trim();
			if (query) searchTracks(token, query);
		}
	});

	// Website info button
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
					<p>
						TuneVis compares songs using audio features such as energy, danceability and acousticness. It then ranks similar songs based on the scores of these features
					</p>
					<p>
						Recommendations are filtered either by 'similar songs' or 'similar artists' based on availability, but unfortunately not all songs are available to view
					</p>
					<p>
						Explore recommendations, compare similarity scores, and visualise how tracks relate to each other
					</p>
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

	if (scrollLeftBtn && scrollRightBtn) {
		scrollLeftBtn.addEventListener("click", () => scrollCarouselBy(-320));
		scrollRightBtn.addEventListener("click", () => scrollCarouselBy(320));

		resultsDiv.addEventListener("scroll", updateScrollButtons);
		window.addEventListener("resize", updateScrollButtons);
		updateScrollButtons();
	}
}

init();
