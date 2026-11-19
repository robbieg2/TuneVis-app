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


-- ===========================================================================
-- Migration (Nov 2026): artist album rankings
-- On an existing database, run just this block (from here to the end of the file)
-- in the SQL Editor.
-- ===========================================================================

-- A new kind of saved ranking: an artist's albums (rank.html's "Albums" toggle).
-- The original kind and source checks were created without names, so find them by
-- what they check, drop them, and add named replacements that include the new kind.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.rankings'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) like '%fav_artists%'
           or pg_get_constraintdef(oid) like '%source_id IS NOT NULL%')
  loop
    execute format('alter table public.rankings drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.rankings add constraint rankings_kind_check
  check (kind in ('artist', 'artist_albums', 'album', 'fav_artists', 'fav_tracks'));

-- an artist / album ranking always names what it ranks; favourites never do
alter table public.rankings add constraint rankings_source_check
  check ((kind in ('artist', 'artist_albums', 'album')) = (source_id is not null));


-- ===========================================================================
-- Migration (Nov 2026): separate folders for each kind of ranking
-- On an existing database, run just this block (from here to the end of the file)
-- in the SQL Editor.
-- ===========================================================================

-- Which tab of the saved rankings a kind of ranking belongs to. Folders live in one
-- tab: album rankings and artist album rankings each have their own folders.
create or replace function public.ranking_section(kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case kind
    when 'album'         then 'album'
    when 'artist_albums' then 'artist_albums'
    when 'artist'        then 'artist'
    else 'favourites'    -- fav_artists, fav_tracks
  end;
$$;

alter table public.ranking_folders add column section text not null default 'album';
alter table public.ranking_folders add constraint ranking_folders_section_check
  check (section in ('album', 'artist_albums', 'artist', 'favourites'));

-- Folder names are now unique per user within a section, so "Favourites" can exist
-- for albums and for artist albums.
drop index public.ranking_folders_user_name;
create unique index ranking_folders_user_section_name
  on public.ranking_folders (user_id, section, lower(btrim(name)));

-- Existing folders take the section of the rankings in them. A folder holding
-- several kinds is split: one folder of the same name per section, each keeping
-- its own rankings. Empty folders stay with albums.
do $$
declare
  f record;
  s text;
  first_section text;
  new_id uuid;
begin
  for f in select * from public.ranking_folders loop
    first_section := null;
    for s in
      select distinct public.ranking_section(r.kind)
      from public.ranking_folder_items i
      join public.rankings r on r.id = i.ranking_id
      where i.folder_id = f.id
      order by 1
    loop
      if first_section is null then
        first_section := s;
        update public.ranking_folders set section = s where id = f.id;
      else
        insert into public.ranking_folders (user_id, name, section, created_at)
        values (f.user_id, f.name, s, f.created_at)
        returning id into new_id;
        update public.ranking_folder_items i set folder_id = new_id
        from public.rankings r
        where i.folder_id = f.id and r.id = i.ranking_id
          and public.ranking_section(r.kind) = s;
      end if;
    end loop;
  end loop;
end $$;

-- A ranking can only go into a folder of its own section.
drop policy "Users manage their own folder items" on public.ranking_folder_items;
create policy "Users manage their own folder items"
  on public.ranking_folder_items for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.ranking_folders f
      join public.rankings r on r.id = ranking_id
      where f.id = folder_id and f.section = public.ranking_section(r.kind)
    )
  );


-- ===========================================================================
-- Migration (Nov 2026): social — friends, profiles and the shared feed
-- On an existing database, run just this block (from here to the end of the file)
-- in the SQL Editor. Modelled on the racing map site's friends.
--
-- Who can see what:
--   * usernames: found by search (social.html) and seen by anyone you have a request
--     or friendship with; nothing else about an account is exposed;
--   * rankings: your own, plus your friends' (read only; folders stay private);
--   * feed posts: your own and your friends'.
-- ===========================================================================

-- One row per pair of accounts: a request (pending) or a friendship (accepted). Both
-- need a username (profiles row) first.
create table public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester    uuid not null default auth.uid()
               references public.profiles (user_id) on delete cascade,
  addressee    uuid not null references public.profiles (user_id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  check (requester <> addressee)
);
create unique index friendships_pair
  on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index friendships_addressee on public.friendships (addressee);

-- A ranking shared to the feed, with an optional caption. The feed shows the ranking
-- as it is now (edits show up); deleting the ranking removes its posts.
create table public.ranking_posts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid()
              references auth.users (id) on delete cascade,
  ranking_id  uuid not null references public.rankings (id) on delete cascade,
  caption     text check (char_length(caption) <= 280),
  created_at  timestamptz not null default now()
);
create index ranking_posts_user_created on public.ranking_posts (user_id, created_at desc);
create index ranking_posts_ranking on public.ranking_posts (ranking_id);

-- Helpers for the policies (security definer, so a policy on one table can look at
-- another without recursion). All are about the signed-in user only.
create function public.is_friend(other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester = (select auth.uid()) and f.addressee = other)
        or (f.addressee = (select auth.uid()) and f.requester = other)));
$$;

-- Any request or friendship with them (so a pending request can show their name).
create function public.knows(other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.friendships f
    where (f.requester = (select auth.uid()) and f.addressee = other)
       or (f.addressee = (select auth.uid()) and f.requester = other));
$$;

-- Usernames starting with what was typed (any case), for Add friends. At least 2
-- characters, at most 10 results, never yourself. Only the username comes back.
create function public.search_profiles(p_query text)
returns table (user_id uuid, username text)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.username from public.profiles p
  where char_length(trim(p_query)) >= 2
    and lower(p.username) like replace(replace(replace(lower(trim(p_query)), '\', '\'), '%', '\%'), '_', '\_') || '%'
    and p.user_id <> (select auth.uid())
  order by lower(p.username)
  limit 10;
$$;

-- A username's owner, matched exactly (any case), for a profile link (profile.html?u=).
create function public.profile_by_username(p_username text)
returns table (user_id uuid, username text)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.username from public.profiles p
  where lower(p.username) = lower(trim(p_username));
$$;

revoke all on function public.is_friend(uuid) from public, anon;
revoke all on function public.knows(uuid) from public, anon;
revoke all on function public.search_profiles(text) from public, anon;
revoke all on function public.profile_by_username(text) from public, anon;
grant execute on function public.is_friend(uuid) to authenticated;
grant execute on function public.knows(uuid) to authenticated;
grant execute on function public.search_profiles(text) to authenticated;
grant execute on function public.profile_by_username(text) to authenticated;

alter table public.friendships   enable row level security;
alter table public.ranking_posts enable row level security;

-- Profiles: anyone you have a request or friendship with can see your username.
create policy "Profiles visible to friends and requests"
  on public.profiles for select to authenticated
  using (public.knows(user_id));

-- Requests: anyone can ask (as themselves); only the person asked can accept; either
-- side can withdraw, decline or unfriend (delete).
create policy "Users see their own requests and friendships"
  on public.friendships for select to authenticated
  using ((select auth.uid()) in (requester, addressee));
create policy "Users send requests as themselves"
  on public.friendships for insert to authenticated
  with check (requester = (select auth.uid()) and status = 'pending' and accepted_at is null);
create policy "Users accept requests sent to them"
  on public.friendships for update to authenticated
  using (addressee = (select auth.uid()) and status = 'pending')
  with check (addressee = (select auth.uid()) and status = 'accepted');
create policy "Either side can remove a request or friendship"
  on public.friendships for delete to authenticated
  using ((select auth.uid()) in (requester, addressee));

-- Friends can read each other's rankings (changing them stays owner-only).
create policy "Friends can see rankings"
  on public.rankings for select to authenticated
  using (public.is_friend(user_id));

-- Posts: you post your own rankings only; you and your friends see them; you can
-- delete your own.
create policy "Posts visible to their author and friends"
  on public.ranking_posts for select to authenticated
  using (user_id = (select auth.uid()) or public.is_friend(user_id));
create policy "Users share their own rankings"
  on public.ranking_posts for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.rankings r
                where r.id = ranking_id and r.user_id = (select auth.uid()))
  );
create policy "Users delete their own posts"
  on public.ranking_posts for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.friendships to authenticated;
grant select, insert, delete         on public.ranking_posts to authenticated;


-- ===========================================================================
-- Migration (Nov 2026): public folders
-- On an existing database, run just this block (from here to the end of the file)
-- in the SQL Editor. Needs the social migration above.
--
-- A folder can be made visible to friends (is_public). Friends then see it on your
-- profile, with the rankings in it (they can already see your rankings). Folders are
-- private unless you choose otherwise, and existing ones stay private.
-- ===========================================================================

alter table public.ranking_folders add column is_public boolean not null default false;

create policy "Friends see public folders"
  on public.ranking_folders for select to authenticated
  using (is_public and public.is_friend(user_id));

-- The subquery runs under the friend's own row-level security, so it only finds
-- folders they're allowed to see (their own, or a friend's public one).
create policy "Friends see what's in public folders"
  on public.ranking_folder_items for select to authenticated
  using (exists (
    select 1 from public.ranking_folders f
    where f.id = folder_id and f.is_public and f.user_id <> (select auth.uid())
  ));
