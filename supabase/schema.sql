-- TuneVis accounts schema
-- Run once in Supabase: SQL Editor → New query → paste all of this → Run.
--
-- Accounts themselves are Supabase Auth users (auth.users). These tables hold what an
-- account saves: rankings and recently viewed tracks. Every table has row-level
-- security, so a signed-in user can only ever see and change their own rows, and
-- everything a user saved is deleted with their account (on delete cascade).

-- ---------------------------------------------------------------------------
-- Saved rankings: an artist / album ranking (rank.html) or a favourites ranking
-- (rank-general.html). item_ids is the ranked order, which is what the page's URL
-- carries; items is a snapshot of each item's name / subtitle / image at save time,
-- so the saved list can be shown without calling Spotify.
-- ---------------------------------------------------------------------------
create table public.rankings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid()
               references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('artist', 'album', 'fav_artists', 'fav_tracks')),
  source_id    text check (char_length(source_id) <= 64),    -- Spotify artist / album id
  source_name  text check (char_length(source_name) <= 300), -- artist / album name
  genre        text check (char_length(genre) <= 40),         -- favourites only
  title        text not null check (char_length(title) between 1 and 120),
  size         smallint not null check (size between 1 and 200),
  item_ids     text[] not null check (cardinality(item_ids) <= 200),
  items        jsonb not null check (jsonb_typeof(items) = 'array'
                                     and octet_length(items::text) <= 100000),
  image        text check (char_length(image) <= 500),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- an artist / album ranking always names what it ranks; favourites never do
  check ((kind in ('artist', 'album')) = (source_id is not null))
);
create index rankings_user_updated on public.rankings (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Recently viewed tracks (the home page carousel), kept to the newest 10 per user.
-- ---------------------------------------------------------------------------
create table public.recently_viewed (
  user_id    uuid not null default auth.uid()
             references auth.users (id) on delete cascade,
  track_id   text not null check (char_length(track_id) <= 64),
  name       text not null check (char_length(name) <= 300),
  artists    text[] not null default '{}' check (cardinality(artists) <= 20),
  image      text check (char_length(image) <= 500),
  viewed_at  timestamptz not null default now(),
  primary key (user_id, track_id)
);

-- ---------------------------------------------------------------------------
-- Row-level security: every user can only see and change their own rows.
-- ---------------------------------------------------------------------------
alter table public.rankings        enable row level security;
alter table public.recently_viewed enable row level security;

create policy "Users manage their own rankings"
  on public.rankings for all to authenticated
  using      ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users manage their own recently viewed"
  on public.recently_viewed for all to authenticated
  using      ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.rankings        to authenticated;
grant select, insert, update, delete on public.recently_viewed to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
-- updated_at follows every change to a ranking (the saved list is sorted by it).
create function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger rankings_touch_updated_at
  before update on public.rankings
  for each row execute function public.touch_updated_at();

-- Keep only the newest 10 recently viewed tracks per user. Runs as the user
-- (security invoker), so it can only ever trim that user's own rows.
create function public.trim_recently_viewed()
returns trigger language plpgsql set search_path = '' as $$
begin
  delete from public.recently_viewed rv
  where rv.user_id = new.user_id
    and rv.track_id not in (
      select r.track_id from public.recently_viewed r
      where r.user_id = new.user_id
      order by r.viewed_at desc
      limit 10
    );
  return null;
end;
$$;

create trigger recently_viewed_trim
  after insert or update on public.recently_viewed
  for each row execute function public.trim_recently_viewed();


-- ===========================================================================
-- Migration (Nov 2026): usernames
-- On an existing database, run just this block (from here to the end of the file)
-- in the SQL Editor. A fresh database gets it with everything above.
-- ===========================================================================

-- A user's chosen username: unique regardless of case ("Robbie" and "robbie" can't
-- both exist), 3-20 letters, numbers or underscores, and not a reserved word.
create table public.profiles (
  user_id     uuid primary key default auth.uid()
              references auth.users (id) on delete cascade,
  username    text not null check (
                char_length(username) between 3 and 20
                and username ~ '^[A-Za-z0-9_]+$'
                and lower(username) not in ('admin', 'administrator', 'tunevis', 'support',
                                            'moderator', 'mod', 'root', 'system', 'help',
                                            'official', 'staff', 'null', 'undefined')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index profiles_username_lower on public.profiles (lower(username));

alter table public.profiles enable row level security;

-- For now a user can only see and change their own profile. Showing usernames to
-- other people (friends, shared rankings) is a later step with its own policy.
create policy "Users manage their own profile"
  on public.profiles for all to authenticated
  using      ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.profiles to authenticated;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Whether a username is free, for the live check on the account page. Security
-- definer so it can look past row-level security, but it only ever answers
-- true / false. The user's own current name counts as available.
create function public.username_available(name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.profiles p
    where lower(p.username) = lower(name)
      and p.user_id <> (select auth.uid())
  );
$$;

revoke all on function public.username_available(text) from public, anon;
grant execute on function public.username_available(text) to authenticated;


-- ===========================================================================
-- Migration (Nov 2026): album star ratings and ranking folders
-- On an existing database, run just this block (from here to the end of the file)
-- in the SQL Editor.
-- ===========================================================================

-- An album ranking's overall star rating: 0.5 to 5 in half-star steps, or none.
alter table public.rankings
  add column rating numeric(2, 1)
  check (rating is null
         or (kind = 'album' and rating between 0.5 and 5 and rating * 2 = floor(rating * 2)));

-- A user's folders of saved rankings, e.g. "Favourites", "2026 Releases".
-- Names are unique per user, ignoring case.
create table public.ranking_folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid()
              references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  created_at  timestamptz not null default now()
);
create unique index ranking_folders_user_name on public.ranking_folders (user_id, lower(btrim(name)));

-- Which rankings are in which folders. A ranking can be in several folders (a 2026
-- release can also be a favourite). Deleting a folder or a ranking removes its rows
-- here; it never deletes the other side.
create table public.ranking_folder_items (
  folder_id   uuid not null references public.ranking_folders (id) on delete cascade,
  ranking_id  uuid not null references public.rankings (id) on delete cascade,
  user_id     uuid not null default auth.uid()
              references auth.users (id) on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (folder_id, ranking_id)
);
create index ranking_folder_items_ranking on public.ranking_folder_items (ranking_id);

alter table public.ranking_folders      enable row level security;
alter table public.ranking_folder_items enable row level security;

create policy "Users manage their own folders"
  on public.ranking_folders for all to authenticated
  using      ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- A user can only file their own rankings into their own folders. The subqueries run
-- under the user's own row-level security, so they only ever see that user's rows.
create policy "Users manage their own folder items"
  on public.ranking_folder_items for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.ranking_folders f where f.id = folder_id)
    and exists (select 1 from public.rankings r where r.id = ranking_id)
  );

grant select, insert, update, delete on public.ranking_folders      to authenticated;
grant select, insert, delete         on public.ranking_folder_items to authenticated;
