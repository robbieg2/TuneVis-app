// features-charts.js
function cssSafeId(id) {
	return String(id || "")
		.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// Highlight same track on other visualisations
export function linkHoverHighlight( { trackId, on }) {
	const key = cssSafeId(trackId);
		
	d3.selectAll(`.scatter-dot.dot-${key}`)
		.attr("stroke", on ? "#fff" : "none")
		.attr("stroke-width", on ? 2 : 0)
		.style("opacity", on ? 1 : null);
			
	d3.selectAll(`.bar-rect.bar-${key}`)
		.attr("stroke", on ? "#fff" : "none")
		.attr("stroke-width", on ? 2 : 0)
		.style("opacity", on ? 1 : null);
}

export function explainClosestDims(seed, rec) {
	const dims = [
		{ key: "danceability", label: "Danceability" },
        { key: "energy", label: "Energy" },		
        { key: "valence", label: "Valence" },
        { key: "speechiness", label: "Speechiness" },
        { key: "acousticness", label: "Acousticness" },
		{ key: "instrumentalness", label: "Instrumental" },
    ];
	
	const scored = dims
		.map (d => {
			const a = Number(seed?.[d.key]);
			const b = Number(rec?.[d.key]);
			if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
			return { ...d, diff: Math.abs(a - b) };
		})
		.filter(Boolean)
		.sort((x, y) => x.diff - y.diff);
	
	return scored.slice(0, 3).map(x => x.label);
}

// Tooltips
function getTooltipEl() {
	return document.getElementById("chart-tooltip");
}

function hideTooltip() {
	const tt = getTooltipEl();
	if (!tt) return;
	tt.style.display = "none";
	tt.innerHTML = "";
}

function showTooltipAtRect(html, rect) {
	const tt = getTooltipEl();
	if (!tt || !rect) return;
	tt.innerHTML = html;
	tt.style.display = "block";
	
	const tw = tt.offsetWidth || 260;
	const th = tt.offsetHeight || 90;
	
	const pad = 10;
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	
	let x = rect.right + pad;
	let y = rect.top + rect.height / 2 - th / 2;
	
	if (x + tw + pad > vw) x = rect.left - tw - pad;
	
	x = Math.max(pad, Math.min(vw - tw - pad, x));
	y = Math.max(pad, Math.min(vh - th - pad, y));
		
	tt.style.left = `${x}px`;
	tt.style.top = `${y}px`;
	tt.style.transform = "none";
}

function buildTooltipHtml(r) {
	const name = r.track?.name || "Unknown Track";
	const artists = (r.track?.artists || []).join(", ") || "Unknown Artist";
	const simPct = Number.isFinite(r.score) ? Math.round(r.score * 100) : null;
	
	const closest = 
		window.__seedFeatures && r?.features
			? explainClosestDims(window.__seedFeatures, r.features)
			: [];
			
	const closestText = closest.length ? closest.join(" • ") : "-";

	return `
		<div class="tt-title">${name}</div>
		<div class="tt-sub">${artists}</div>
		<div class="tt-row"><span class="tt-muted">Similarity Score</span><span>${simPct ?? "-"}%</span></div>
		<div class="tt-row"><span class="tt-muted">Closest Features</span><span>${closestText}</span></div>
	`;
}
	
// Radar chart comparing recommendations with seed song
export function drawMultiRadarChart(series) {
    const container = document.getElementById("sim-radar");
	if (!container) return;
	
    d3.select(container).selectAll("svg").remove();
	d3.select(container).selectAll("div").remove();

    const axes = [
        { key: "danceability", label: "Danceability" },
        { key: "energy", label: "Energy" },		
        { key: "valence", label: "Valence" },
        { key: "speechiness", label: "Speechiness" },
        { key: "acousticness", label: "Acousticness" },
		{ key: "instrumentalness", label: "Instrumental" },
    ];

	const normalized = (series || [])
		.map(s => {
			const points = axes.map((a) => ({
				axis: a.label,
				key: a.key,
				value: Number(s.features?.[a.key])
			})).map((p) => ({
				...p,
				value: Number.isFinite(p.value) ? Math.max(0, Math.min(1, p.value)) : 0
			}));
			
			return { ...s, points };
		})
		.filter(s => s.points.length === axes.length);
	
    if (!normalized.length) {
        container.innerHTML += `<p>No usable feature values returned for this track</p>`;
        return;
    }
	
    const width = 420;
    const height = 420;
    const radius = Math.min(width, height) / 2 - 50;
    const levels = 5;
    const angleSlice = (Math.PI * 2) / axes.length;

    const svg = d3.select(container)
        .append("svg")
        .attr("width", width)
        .attr("height", height)
        .append("g")
        .attr("transform", `translate(${width / 2}, ${height / 2})`);

    const rScale = d3.scaleLinear().domain([0, 1]).range([0, radius]);

    for (let level = 1; level <= levels; level++) {
        svg.append("circle")
            .attr("r", (radius / levels) * level)
            .style("fill", "none")
            .style("stroke", "#444");
    }

    axes.forEach((d, i) => {
        const angle = angleSlice * i - Math.PI / 2;
        const x = rScale(1.05) * Math.cos(angle);
        const y = rScale(1.05) * Math.sin(angle);

        svg.append("line")
            .attr("x1", 0)
            .attr("y1", 0)
            .attr("x2", rScale(1) * Math.cos(angle))
            .attr("y2", rScale(1) * Math.sin(angle))
            .style("stroke", "#555");

        svg.append("text")
            .attr("x", x)
            .attr("y", y)
            .style("fill", "#fff")
            .style("font-size", "12px")
            .style("text-anchor", "middle")
            .text(d.label);
    });

    const radarLine = d3.lineRadial()
        .radius((d) => rScale(d.value))
        .angle((d, i) => i * angleSlice)
        .curve(d3.curveLinearClosed);
		
	const root = d3.select("#sim-radar");	
	const palette = ["#ffffff", "#1db954", "#3ea6ff", "#ff7a00", "#b26bff", "#ff4d6d"];
		
	normalized.forEach((s, idx) => {
		const stroke = s.isSeed ? palette[0] : palette[(idx % (palette.length - 1)) + 1];
		const key = cssSafeId(s.id);

		svg.append("path")
			.datum(s.points)
			.attr("d", radarLine)
			.attr("class", `radar-series series-${key} ${s.isSeed ? "seed-series" : ""}`)
			.style("fill", stroke)
			.style("fill-opacity", s.isSeed ? 0.08 : 0.03)
			.style("stroke", stroke)
			.style("stroke-width", s.isSeed ? 3.5 : 1.6)
			.style("opacity", s.isSeed ? 1 : 0.7);
	});
	
	const seed = normalized.find(s => s.isSeed);
	if (seed) {
		svg.selectAll(".seed-dot")
			.data(seed.points)
			.enter()
			.append("circle")
			.attr("class", "seed-dot")
			.attr("cx", (d, i) => rScale(d.value) * Math.cos(i * angleSlice - Math.PI / 2))
			.attr("cy", (d, i) => rScale(d.value) * Math.sin(i * angleSlice - Math.PI / 2))
			.attr("r", 3.5)
			.attr("fill", "#fff");
	}
	
	// Chart legend
	const legend = d3.select(container)
    .append("div")
    .style("display", "flex")
    .style("gap", "12px")
    .style("flex-wrap", "wrap")
    .style("justify-content", "center")
    .style("margin-top", "10px");

	const state = {
		soloKey: null,
	};

	function showAll() {
		svg.selectAll(".radar-series, .seed-dot").style("display", null);
	}

	function showSolo(key) {
		svg.selectAll(".radar-series:not(.seed-series)").style("display", "none");

		svg.selectAll(".seed-series, .seed-dot").style("display", null);
		svg.selectAll(`.series-${key}`).style("display", null);
		
		svg.selectAll(".seed-series").raise();
		svg.selectAll(".seed-dot").raise();
	}

	normalized.forEach((s, idx) => {
		const color = s.isSeed ? palette[0] : palette[(idx % (palette.length - 1)) + 1];
		const key = cssSafeId(s.id);

		const item = legend.append("button")
			.attr("type", "button")
			.style("display", "flex")
			.style("align-items", "center")
			.style("gap", "8px")
			.style("font-size", "12px")
			.style("opacity", "0.95")
			.style("background", "transparent")
			.style("border", s.isSeed ? "1px solid rgba(255,255,255,0.45)" : "1px solid rgba(255,255,255,0.14)")
			.style("border-radius", "999px")
			.style("padding", "6px 10px")
			.style("cursor", s.isSeed ? "default" : "pointer");

		item.append("span")
			.style("display", "inline-block")
			.style("width", s.isSeed ? "12px" : "10px")
			.style("height", s.isSeed ? "12px" : "10px")
			.style("border-radius", "50%")
			.style("background", color)
			.style("box-shadow", s.isSeed ? "0 0 0 2px rgba(255,255,255,0.25)" : "none");

		item.append("span")
			.style("font-weight", s.isSeed ? "600" : "400")
			.text(s.label.length > 34 ? s.label.slice(0, 34) + "…" : s.label);

		if (s.isSeed) return;

		item.on("click", () => {
			if (state.soloKey === key) {
				state.soloKey = null;
				showAll();

				legend.selectAll("button")
					.style("opacity", "0.95")
					.style("text-decoration", "none");
			} else {
				state.soloKey = key;
				showSolo(key);

				legend.selectAll("button")
					.style("opacity", "0.35")
					.style("text-decoration", "line-through");

				legend.selectAll("button")
					.filter(function () {
						return this.textContent && this.textContent.startsWith("Seed");
					})
					.style("opacity", "1")
					.style("text-decoration", "none");

				item
					.style("opacity", "1")
					.style("text-decoration", "none");
			}
		});
	});
}

// Bar chart showing similarity scores
export function drawSimilarityBarChart(rows = []) {
    const container = document.getElementById("sim-bar");
    if (!container) return;
    container.innerHTML = "";
	
	const safeRows = Array.isArray(rows) ? rows : [];
    const width = Math.min(760, container.clientWidth || 760);
    const height = 480;
    const margin = { top: 20, right: 70, bottom: 40, left: 220 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = d3.select(container).append("svg").attr("width", width).attr("height", height);
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear().domain([0, 1]).range([0, innerW]);
    const y = d3
        .scaleBand()
        .domain(rows.map((r) => r.id))
        .range([0, innerH])
        .padding(0.15);

    g.append("g")
        .attr("transform", `translate(0,${innerH})`)
        .call(d3.axisBottom(x).ticks(5))
        .selectAll("text")
        .style("fill", "#fff");

    g.append("g")
        .call(
            d3.axisLeft(y).tickFormat((id) => {
                const r = safeRows.find((x) => x.id === id);
                const name = r?.track?.name || id;
                const artists = (r?.track?.artists || []).join(", ");
                const label = `${name} — ${artists}`;
                return label.length > 40 ? label.slice(0, 40) + "…" : label;
            })
        )
        .selectAll("text")
        .style("fill", "#fff");

    g.selectAll("rect.bar-rect")
        .data(safeRows, (d) => d.id)
        .enter()
        .append("rect")
		.attr("class", d => `bar-rect bar-${cssSafeId(d.id)}`)
        .attr("x", 0)
        .attr("y", (d) => y(d.id))
        .attr("width", (d) => x(d.score))
        .attr("height", y.bandwidth())
        .attr("fill", "#1db954")
		.style("opacity", 0.85)
        .style("cursor", "pointer")
		
		.on("mouseenter", (event, d) => {
			linkHoverHighlight({ trackId: d.id, on: true });
			
			const rect = event.currentTarget.getBoundingClientRect();
			showTooltipAtRect(buildTooltipHtml(d), rect);
			
			window.dispatchEvent(
				new CustomEvent("rec-hover", {
					detail: { trackId: d.id, source: "bar", payload: { row: d }, showTooltip: true },
				})
			);
		})
			
		.on("mouseleave", (event, d) => {
			linkHoverHighlight({ trackId: d.id, on: false });
			hideTooltip();
			
			window.dispatchEvent(
				new CustomEvent("rec-hover", {
					detail: { trackId: null, source: "bar" },
				})
			);
		})
		
        .on("click", (event, d) => {
            const trackParam = encodeURIComponent(JSON.stringify(d.track));
            window.location.href = `features.html?track=${trackParam}`;
        });
		
    g.selectAll(".score-label")
        .data(safeRows)
        .enter()
        .append("text")
		.attr("class", "score-label")
        .attr("x", (d) => x(d.score) + 6)
        .attr("y", (d) => y(d.id) + y.bandwidth() / 2 + 4)
        .attr("fill", "#fff")
        .attr("font-size", "12px")
        .text((d) => (Number.isFinite(d.score) ? d.score.toFixed(2) : "-"));
		
	window.removeEventListener("rec-hover", window.__barHoverHandler);
	
	window.__barHoverHandler = (e) => {
		const detail = e?.detail || {};
		const source = detail.source || null;
		
		const idRaw = detail.trackId || null;
		const id = idRaw ? cssSafeId(idRaw) : null;
		
		g.selectAll("rect.bar-rect").style("opacity", id ? 0.25 : 0.85).attr("stroke", "none");
		d3.selectAll(".scatter-dot").style("opacity", id ? 0.25 : 0.75).attr("stroke", "none");

		if (!id) {
			if (source === "bar" || source === "recs") hideTooltip();
			return;
		}
		
		g.selectAll(`.bar-${id}`).style("opacity", 1).attr("stroke", "#fff").attr("stroke-width", 1.5);
		d3.selectAll(`.scatter-dot.dot-${id}`).style("opacity", 1).attr("stroke", "#fff").attr("stroke-width", 1.5);
		
		if (source !== "bar" && source !== "recs") return;
		
		const payloadRow = detail?.payload?.row || null;
		const wantsTooltip = Boolean(detail?.showTooltip);

		if (wantsTooltip && payloadRow) {
			const barEl = container.querySelector(`.bar-${id}`);
			if (barEl) showTooltipAtRect(buildTooltipHtml(payloadRow), barEl.getBoundingClientRect());
		} else {
			hideTooltip();
		}
	};
	
	window.addEventListener("rec-hover", window.__barHoverHandler);
}

// Scatter chart showing recommended songs
export function drawSimilarityScatter(seedFeatures, rows = []) {
    const container = document.getElementById("sim-scatter");
    if (!container) return;

    const xSel = document.getElementById("x-feature");
    const ySel = document.getElementById("y-feature");

    const width = Math.min(560, container.clientWidth || 560);
    const height = 450;
    const margin = { top: 20, right: 20, bottom: 50, left: 60 };

    function getVal(f, key) {
        const v = Number(f?.[key]);
        return Number.isFinite(v) ? v : null;
    }
	
	const tooltip = document.getElementById("chart-tooltip");

	function showTooltip(html) {
		if (!tooltip) return;
		tooltip.innerHTML = html;
		tooltip.style.display = "block";
	}

	function moveTooltip(event) {
		if (!tooltip) return;

		const pad = 12;

		const tw = tooltip.offsetWidth || 260;
		const th = tooltip.offsetHeight || 90;

		const vw = window.innerWidth;
		const vh = window.innerHeight;

		let x = event.clientX + pad;
		let y = event.clientY + pad;

		if (x + tw + pad > vw) x = event.clientX - tw - pad;
		if (y + th + pad > vh) y = event.clientY - th - pad;

		x = Math.max(pad, Math.min(vw - tw - pad, x));
		y = Math.max(pad, Math.min(vh - th - pad, y));

		tooltip.style.left = `${x}px`;
		tooltip.style.top = `${y}px`;
		tooltip.style.transform = "none";
	}

	function hideTooltip() {
		if (!tooltip) return;
		tooltip.style.display = "none";
		tooltip.innerHTML = "";
	}

    function render() {
        container.innerHTML = "";

        const xKey = xSel?.value || "energy";
        const yKey = ySel?.value || "valence";

        const points = (Array.isArray(rows) ? rows : [])
            .map((r) => ({
                ...r,
                x: getVal(r.features, xKey),
                y: getVal(r.features, yKey),
            }))
            .filter((p) => p.x != null && p.y != null);

        const seedX = getVal(seedFeatures, xKey);
        const seedY = getVal(seedFeatures, yKey);

        const svg = d3.select(container).append("svg").attr("width", width).attr("height", height);

        const innerW = width - margin.left - margin.right;
        const innerH = height - margin.top - margin.bottom;

        const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

        const xDomain = d3.extent(points.map((p) => p.x));
        const yDomain = d3.extent(points.map((p) => p.y));

        if (seedX != null) {
            xDomain[0] = Math.min(xDomain[0], seedX);
            xDomain[1] = Math.max(xDomain[1], seedX);
        }
        if (seedY != null) {
            yDomain[0] = Math.min(yDomain[0], seedY);
            yDomain[1] = Math.max(yDomain[1], seedY);
        }

        const pad = (min, max) => {
            const span = max - min || 1;
            return [min - span * 0.05, max + span * 0.05];
        };

        const x = d3.scaleLinear().domain(pad(xDomain[0], xDomain[1])).range([0, innerW]);
        const y = d3.scaleLinear().domain(pad(yDomain[0], yDomain[1])).range([innerH, 0]);

        g.append("g")
            .attr("transform", `translate(0,${innerH})`)
            .call(d3.axisBottom(x).ticks(6))
            .selectAll("text")
            .style("fill", "#fff");

        g.append("g").call(d3.axisLeft(y).ticks(6)).selectAll("text").style("fill", "#fff");

        g.append("text")
            .attr("x", innerW / 2)
            .attr("y", innerH + 40)
            .attr("text-anchor", "middle")
            .attr("fill", "#fff")
            .text(xKey);

        g.append("text")
            .attr("transform", "rotate(-90)")
            .attr("x", -innerH / 2)
            .attr("y", -45)
            .attr("text-anchor", "middle")
            .attr("fill", "#fff")
            .text(yKey);

        const dots = g
			.selectAll("circle.scatter-dot")
            .data(points, (d) => d.id)
            .enter()
            .append("circle")
			.attr("class", d => `scatter-dot dot-${cssSafeId(d.id)}`)
            .attr("cx", (d) => x(d.x))
            .attr("cy", (d) => y(d.y))
            .attr("r", (d) => 6 + d.score * 6)
            .attr("fill", "#1db954")
            .style("opacity", 0.75)
            .style("cursor", "pointer")
			
			.on("mouseenter", (event, d) => {
				linkHoverHighlight({ trackId: d.id, on:true });
				
				const name = d?.track?.name || "Unknown Track";
				const artists = (d?.track?.artists || []).join(", ") || "Unknown Artist";

				const fmt = (key, v) => {
					if (!Number.isFinite(v)) return "-";
					if (key === "tempo") return `${Math.round(v)} BPM`;
					return `${Math.round(v * 100)}%`;
				};
				
				showTooltip(`
					<div class="tt-title">${name}</div>
					<div class="tt-sub">${artists}</div>
					
					<div class="tt-row">
						<span class="tt-muted">${xKey.toUpperCase()}</span>
						<span>${fmt(xKey, d.x)}</span>
					</div>
					
					<div class="tt-row">
						<span class="tt-muted">${yKey.toUpperCase()}</span>
						<span>${fmt(yKey, d.y)}</span>
					</div>
				`);

				moveTooltip(event);
						
				window.dispatchEvent(
					new CustomEvent("rec-hover", {
						detail: { trackId: d.id, source: "scatter", payload: { row: d } },
					})
				);
				
				d3.select(event.currentTarget).style("opacity", 1).attr("stroke", "#fff").attr("stroke-width", 1.5);
			})
			
			.on("mousemove", (event) => moveTooltip(event))

			.on("mouseleave", (event, d) => {
				linkHoverHighlight({ trackId: d.id, on:false });
				hideTooltip();
				
				window.dispatchEvent(
					new CustomEvent("rec-hover", {
						detail: { trackId: null, source: "scatter" },
					})
				);

				d3.select(event.currentTarget).style("opacity", 0.75).attr("stroke", "none");
			})		
			
            .on("click", (event, d) => {
                const trackParam = encodeURIComponent(JSON.stringify(d.track));
                window.location.href = `features.html?track=${trackParam}`;
            });

        if (seedX != null && seedY != null) {
            g.append("circle")
				.attr("cx", x(seedX))
				.attr("cy", y(seedY))
				.attr("r", 10)
				.attr("fill", "#fff")
				.style("opacity", 0.9);
				
            g.append("text")
				.attr("x", x(seedX) + 12)
				.attr("y", y(seedY) + 4)
				.attr("fill", "#fff")
				.attr("font-size", "12px")
				.text("Seed");
        }
		
		window.removeEventListener("rec-hover", window.__scatterHoverHandler);
	
		window.__scatterHoverHandler = (e) => {
			const id = e.detail?.trackId ? cssSafeId(e.detail.trackId) : null;
			
			d3.select(container).selectAll("circle.scatter-dot")
				.style("opacity", id ? 0.25 : 0.75)
				.attr("stroke", "none");
				
			if (id) {
				d3.select(container).selectAll(`.scatter-dot.dot-${id}`)
					.style("opacity", 1)
					.attr("stroke", "#fff")
					.attr("stroke-width", 1.5);
			}
		};
		
		window.addEventListener("rec-hover", window.__scatterHoverHandler);
    }

    render();
    if (xSel) xSel.addEventListener("change", render);
    if (ySel) ySel.addEventListener("change", render);
}
