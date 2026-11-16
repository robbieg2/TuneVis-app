# TuneVis

Music discovery, audio-feature analysis and ranking web app. Plain HTML, CSS and
JavaScript (ES modules, no build step), hosted on Vercel.

- Search for a song and see its audio features, charts and similar-track recommendations.
- Rank an artist's top tracks or an album, or build favourite artists / tracks lists.
- Optional TuneVis accounts (Supabase) save rankings and sync Recently Viewed across devices.

## Running locally

```bash
vercel dev
```

Needs these Vercel environment variables (pull them with `vercel env pull`):

| Variable | Used by |
| --- | --- |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | `api/token.js` (Spotify Client Credentials) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `api/delete-account.js` (account deletion only) |

## Setting up accounts (Supabase)

Accounts stay switched off until step 2 is done; the rest of the site works without them.

1. **Create a Supabase project** (free tier) at supabase.com. Use a separate project from
   any other site so users and data stay apart.
2. **Browser settings:** in Project Settings → API, copy the project URL
   (`https://<ref>.supabase.co`) and the anon / publishable key into
   `scripts/supabase-config.js`. Both are safe to commit: row-level security protects the data.
3. **Database:** SQL Editor → New query → paste all of `supabase/schema.sql` → Run.
4. **URL configuration** (Authentication → URL Configuration): set **Site URL** to the live
   site, e.g. `https://<your-app>.vercel.app`. Add `http://localhost:3000/**` under
   **Redirect URLs** for local testing.
5. **Email templates** (Authentication → Emails). Email links must go to
   `auth-confirm.html` with a token hash, so they work on whichever device opens them.
   Replace each template's link:

   | Template | Link `href` |
   | --- | --- |
   | Confirm signup | `{{ .SiteURL }}/auth-confirm.html?token_hash={{ .TokenHash }}&type=email` |
   | Reset password | `{{ .SiteURL }}/auth-confirm.html?token_hash={{ .TokenHash }}&type=recovery` |
   | Invite user | `{{ .SiteURL }}/auth-confirm.html?token_hash={{ .TokenHash }}&type=invite` |
   | Change email address | `{{ .SiteURL }}/auth-confirm.html?token_hash={{ .TokenHash }}&type=email_change` |

6. **Account deletion:** in Vercel → Project → Settings → Environment Variables, add
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API → service_role /
   secret key). Never put the service-role key in browser code or commit it.
7. **Sending email to everyone:** Supabase's built-in email only delivers to the
   project's team members and is heavily rate limited. Before opening sign-ups to the
   public, set up custom SMTP (Authentication → Emails → SMTP settings), e.g. with Resend.
   Until then, invite people from Authentication → Users → Invite user, or add them as
   team members.
