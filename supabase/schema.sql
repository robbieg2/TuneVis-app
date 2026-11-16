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
