# TuneVis

Music discovery, audio-feature analysis and ranking web app. Vanilla HTML/CSS/JS (ES modules, no bundler, no framework), hosted on Vercel.

## Architecture
- **Spotify auth**: Client Credentials flow. The browser calls the Vercel serverless proxy `/api/token` (holds the client secret) and caches the token in localStorage (`spotify_cc_token`, ~1hr lifetime). No user login, no user accounts (Spotify dev mode caps at 5 users, which is why this design was chosen).
- **Stale tokens**: every fetch wrapper (`spotifyGet` / `spotifyFetch`) retries once on 401 via `getSpotifyToken(true)`. Keep this pattern for any new Spotify call.
- **Other APIs**: Last.fm (trending charts, genre tag charts, `track.getSimilar`), ReccoBeats (audio features, with multi-pass fallback search for older catalog).
- **State**: localStorage for caches (1hr TTL, keyed per mode+genre) and recently viewed; URL query params for shareable ranking state (`mode`, `genre`, `size`, `order`, `name`) via `history.replaceState`.

## Pages and scripts (scripts/ and styles/style.css, one shared stylesheet)
- `index.html` – landing page, Get Started button.
- `home.html` + `home.js` – song search (debounced live), Trending tab (genre dropdown, 12 curated genres) and Recently Viewed carousel, Rankings nav button.
- `features.html` + `features.js`, `features-data.js`, `features-charts.js` – audio-features dashboard for a track: charts, recommendations with score badges, clickable artist names opening a top-tracks modal, "coming soon" message when ReccoBeats has no features yet. Back button uses `history.back()`.
- `rankings.html` + `rankings.js` – search for an artist/album to rank, plus CTA to the general rankings page.
- `rank.html` + `rank.js` – artist/album ranking workspace: top 5/10 (artist) or top 5/whole album (album), tap-to-add desktop two-column layout, tabbed mobile layout, catalog search with per-result `+`, album-name search expands to tracks, Spotify embed play button.
- `rank-general.html` + `rank-general.js` – favourite artists / favourite tracks (global, not scoped), genre-filtered popular pool, independent ranking state per mode (`modeState`).
- `rank-share.js` – shared export helpers: `buildRankingText`, `buildRankingImage` (canvas PNG), `downloadCanvas`, `copyText`. Used by both ranking pages along with an editable list name (`#list-name-input`) and Export button/modal.
- `auth.js` – token helper plus `saveToRecent` / `getRecent`.

## Conventions and gotchas
- Debounced searches use a `requestId` counter to ignore out-of-order responses; keep doing this.
- Persistent DOM nodes that get re-rendered must guard listeners with `dataset.*Wired` flags to avoid accumulation.
- Use HTML entity glyphs (`&#8592;`, `&#10005;` etc.) for icons. No icon font is loaded.
- Clear search inputs on bfcache restore via `pageshow` + `event.persisted`.
- Pages that need footer pinning use `class="page-flex"` on body.
- Canvas export loads images with `crossOrigin="anonymous"` and falls back to a placeholder on failure to avoid tainting.
- Any API- or URL-derived text interpolated into an `innerHTML` template must go through `esc()` from `auth.js` (names, subtitles, image URLs, ids in iframe `src`). `features.html?track=` takes raw JSON from the URL, so skipping this is an XSS hole. d3 `.text()` is already safe.

## Known state
- `api/token.js` is the Client Credentials proxy; it reads `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` from Vercel env vars. Local testing needs `vercel dev` with those set.
- Spotify user login (personalised experience) existed previously but was removed after Spotify tightened developer registration requirements. Don't reintroduce user-auth flows without checking current Spotify policy.
- The Last.fm API key is hard-coded in `home.js`, `features.js` and `rank-general.js`; the 401-retry fetch wrapper is duplicated per script.
- Ideas not yet built: genre-aware recommendations on features page, accessibility pass, README.
