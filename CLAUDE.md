# TuneVis

Music discovery, audio-feature analysis and ranking web app. Vanilla HTML/CSS/JS (ES modules, no bundler, no framework), hosted on Vercel.

## Architecture
- **Spotify auth**: Client Credentials flow. The browser calls the Vercel serverless proxy `/api/token` (holds the client secret) and caches the token in localStorage (`spotify_cc_token`, ~1hr lifetime). No Spotify user login (Spotify dev mode caps at 5 users, which is why this design was chosen).
- **TuneVis accounts (Supabase)**: own email + password accounts, modelled on the developer's racing map site. supabase-js is loaded with a dynamic `import()` from a pinned jsdelivr build in `scripts/supabase.js` (`getSupabase()` returns null if unconfigured or the CDN fails, so account code must never block the music pages). Public URL + anon key live in `scripts/supabase-config.js`; empty = accounts off (no header button, no Save buttons). Email links use token_hash templates landing on `auth-confirm.html` (setup steps in README). Schema in `supabase/schema.sql`, run by hand in the SQL editor; every table has RLS and `on delete cascade` from `auth.users`. The service-role key is only used server-side in `api/delete-account.js`, which takes the user from the verified token, never the body.
- **What accounts save**: rankings (`public.rankings`; the row stores the same state as the ranking URL, reopened via `rankingUrl()` with `?saved=<id>` so saving again updates that row) and recently viewed (`public.recently_viewed`, trimmed to 10 by trigger; `syncRecent()` merges local + remote by `viewedAt`).
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
- `auth.js` – token helper, `esc()`, and recently viewed (`saveToRecent` / `getRecent` / `syncRecent`, which also sync to the account when signed in).
- `login.html`, `signup.html`, `forgot-password.html`, `update-password.html`, `auth-confirm.html`, `account.html` + `auth-pages.js` – account pages; each sets `<body data-auth-page="…">`. Post-login redirects go through `safeNext()` (same-site paths only).
- `account-nav.js` – round account button injected into the page header (moves the header's right-hand button left via `.has-account-chip`). Included on every music page.
- `saved-rankings.js` – `initSaveButton` (Save / Save changes / Saved ✓ on both ranking pages), `listRankings`, `deleteRanking`, `rankingUrl`. The saved list is shown on `rankings.html` (`#saved-rankings`).

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
- Accounts are built (Nov 2026, `feature/accounts`) and tested against a local mock of Supabase, not yet against a real project. Supabase's built-in email only reaches project team members until custom SMTP is set up.
- On phones the decorative `.bg-circle` elements widen the page to ~535px, so mobile browsers zoom out slightly. Predates accounts.
- Ideas not yet built: genre-aware recommendations on features page, accessibility pass.
