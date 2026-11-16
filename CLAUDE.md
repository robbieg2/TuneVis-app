# TuneVis

Music discovery, audio-feature analysis and ranking web app. Vanilla HTML/CSS/JS (ES modules, no bundler, no framework), hosted on Vercel.

## Architecture
- **Spotify auth**: Client Credentials flow. The browser calls the Vercel serverless proxy `/api/token` (holds the client secret) and caches the token in localStorage (`spotify_cc_token`, ~1hr lifetime). No Spotify user login (Spotify dev mode caps at 5 users, which is why this design was chosen).
- **TuneVis accounts (Supabase)**: own email + password accounts, modelled on the developer's racing map site. supabase-js is loaded with a dynamic `import()` from a pinned jsdelivr build in `scripts/supabase.js` (`getSupabase()` returns null if unconfigured or the CDN fails, so account code must never block the music pages). Public URL + anon key live in `scripts/supabase-config.js`; empty = accounts off (no header button, no Save buttons). Email links use token_hash templates landing on `auth-confirm.html` (setup steps in README). Schema in `supabase/schema.sql`, run by hand in the SQL editor; every table has RLS and `on delete cascade` from `auth.users`. The service-role key is only used server-side in `api/delete-account.js`, which takes the user from the verified token, never the body.
- **What accounts save**: rankings (`public.rankings`; the row stores the same state as the ranking URL, reopened via `rankingUrl()` with `?saved=<id>` so saving again updates that row) and recently viewed (`public.recently_viewed`, trimmed to 10 by trigger). Recently Viewed is signed-in only: `saveToRecent` records nothing while signed out, the home tab shows a log-in prompt (`#recent-signin`) instead, and the localStorage copy is just a cache of the account's list, cleared on sign in, sign out and account deletion (`clearRecentCache`). `home.html?tab=recent` opens that tab.
- **Usernames** (`public.profiles`, Nov 2026 migration at the end of `supabase/schema.sql`): one per account, 3–20 letters/numbers/underscores, unique ignoring case, reserved words blocked by a check constraint (mirrored in `profile.js`). Chosen and changed on the account page with a live availability check (`username_available()` RPC, security definer, true/false only). Only the owner can read their profile for now; showing usernames to others will need its own policy. A display copy lives in the account's `user_metadata.username` so the header chip can show it without a query; it's re-validated before display and never trusted for anything else.
- **Logo / brand**: wordmark in Fredoka 600 (Google Fonts, loaded on every page) with a pink→violet gradient (`#ff9ad8 → #d68bff → #a98bff`) over green bars (`url(#tv-bars)` gradient defined in each page's logo SVG). Body text still falls back to the system font: "Poppins" is named in the CSS but never loaded.
- **Icons**: `favicon.ico` (16/32/48), `icons/` (favicon.svg, apple-touch-icon, 192/512 "any" and maskable app icons, og-image 1200×630) and `manifest.webmanifest`, linked in every page's `<head>`. Small sizes use a 3-bar mark, app icons a 5-bar one. They were rendered from SVG in a browser; to change them, redraw rather than hand-edit the PNGs. Every page has `og:` / `twitter:` tags pointing at `https://tunevis.vercel.app/icons/og-image.png` (the live site).
- **Album star ratings** (Nov 2026 ratings/folders migration): `rankings.rating`, 0.5–5 in half steps, album rankings only (check constraint). `star-rating.js` provides the widget (`createStarRating`, slider role, arrow keys, left/right half of a star = .5/whole) plus `starsHtml` / `starsText` for display. On `rank.html` it sits under the album name, travels in the URL as `rating`, is part of the saved record and `comparable()`, and appears in exports. The value label and Clear button keep a fixed width so the stars never shift under the pointer.
- **Ranking folders**: `ranking_folders` (unique name per user, ignoring case) and `ranking_folder_items` (many-to-many: a ranking can be in several folders; deleting either side cascades only the link). UI in `rankings-library.js` on `rankings.html`: folder chips (All + each folder with counts, `?folder=<id>` in the URL), New / Rename / Delete folder, and a per-ranking folder dialog with checkboxes that save immediately. Data helpers in `saved-rankings.js`.
- **Before a migration is run**: `saved-rankings.js` falls back when the `rating` column or folder tables don't exist yet (Postgres 42703 / PostgREST PGRST204 / PGRST205): rankings still list and save without the rating, and the folder UI hides. Keep this pattern for future columns that the client depends on.
- **Landing page** (`index.html`): "Log in" button plus Forgotten password / Sign up / Continue without signing in links; no header account button there.
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
- `account-nav.js` – round account button injected into the page header (moves the header's right-hand button left via `.has-account-chip`), showing the username's initial. Included on every music page.
- `rankings-library.js` – "Your saved rankings" on `rankings.html`: folders, ratings, open / delete. `rankings.js` is only the artist/album search.
- `star-rating.js` – half-star rating widget and display helpers.
- `profile.js` – usernames: `usernameProblem`, `getMyUsername`, `isUsernameAvailable`, `saveUsername`, `syncUsernameToSession`.
- `saved-rankings.js` – `initSaveButton` (Save / Save changes / Saved ✓ on both ranking pages), `listRankings`, `deleteRanking`, `rankingUrl`. The saved list is shown on `rankings.html` (`#saved-rankings`).

## Conventions and gotchas
- Debounced searches use a `requestId` counter to ignore out-of-order responses; keep doing this.
- Persistent DOM nodes that get re-rendered must guard listeners with `dataset.*Wired` flags to avoid accumulation.
- Use HTML entity glyphs (`&#8592;`, `&#10005;` etc.) for icons. No icon font is loaded.
- Clear search inputs on bfcache restore via `pageshow` + `event.persisted`.
- Pages that need footer pinning use `class="page-flex"` on body.
- Canvas export loads images with `crossOrigin="anonymous"` and falls back to a placeholder on failure to avoid tainting.
- Any API- or URL-derived text interpolated into an `innerHTML` template must go through `esc()` from `auth.js` (names, subtitles, image URLs, ids in iframe `src`). `features.html?track=` takes raw JSON from the URL, so skipping this is an XSS hole. d3 `.text()` is already safe.
- **Mobile is supported on every page** (phones from 320px up). All mobile rules live in the "Responsive: tablets and phones" section at the end of `style.css` (768px, 480px, 360px), grouped by page; add new ones there. Check new UI at 320, 375 and 768px wide as well as desktop. Rules of thumb: grid columns use `minmax(0, 1fr)` (a plain `1fr` grows to fit wide content like the recommendations carousel); inputs are 16px on mobile (smaller makes iOS zoom); D3 charts size from their container's `clientWidth`, not `window.innerWidth`, and `features-charts.js` redraws them when the window width changes; JS that sets inline `display` needs `!important` in CSS to hide it on mobile.
- `.bg-layer` is `position: fixed; overflow: hidden` so the decorative circles never widen the page.

## Known state
- `api/token.js` is the Client Credentials proxy; it reads `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` from Vercel env vars. Local testing needs `vercel dev` with those set.
- Spotify user login (personalised experience) existed previously but was removed after Spotify tightened developer registration requirements. Don't reintroduce user-auth flows without checking current Spotify policy.
- The Last.fm API key is hard-coded in `home.js`, `features.js` and `rank-general.js`; the 401-retry fetch wrapper is duplicated per script.
- Accounts are live on the developer's Supabase project. Supabase's built-in email only reaches project team members until custom SMTP is set up.
- Ideas not yet built: genre-aware recommendations on features page, accessibility pass.
