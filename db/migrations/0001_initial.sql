-- Hetu application schema.
--
-- Run once on the Neon branch, after the Data API has been enabled with
-- Neon Auth. Enabling it creates the `authenticated` role and the
-- `auth.user_id()` function, which returns the `sub` claim of the verified
-- JWT on each Data API request. This file relies on both.
--
-- Every table belongs to one user. Row-level security limits each signed-in
-- user to their own rows. Guests have no rows and no access.

begin;

-- Keeps updated_at current on every update.
create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- A new message counts as activity in its conversation, so the list of
-- conversations can be ordered by recent use.
create function public.touch_conversation() returns trigger
language plpgsql as $$
begin
  update public.conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$;

create table public.profiles (
  user_id text primary key default auth.user_id(),
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default auth.user_id(),
  title text not null check (char_length(title) between 1 and 120),
  intent text check (intent in ('understand', 'solve', 'examine')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Lets child tables reference a conversation together with its owner.
  unique (id, user_id)
);
create index conversations_by_owner on public.conversations (user_id, updated_at desc);

-- One row per message. Hetu's replies keep their small structured extras
-- (action, specialists, checks, proof inspection) in `meta`.
create table public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null,
  user_id text not null default auth.user_id(),
  role text not null check (role in ('student', 'hetu')),
  content text not null check (char_length(content) between 1 and 20000),
  meta jsonb check (meta is null or pg_column_size(meta) <= 65536),
  created_at timestamptz not null default now(),
  -- A message can only be attached to a conversation with the same owner.
  foreign key (conversation_id, user_id) references public.conversations (id, user_id) on delete cascade
);
create index messages_by_conversation on public.messages (conversation_id, id);

-- Hetu's session notes for one conversation.
create table public.learning_states (
  conversation_id uuid primary key,
  user_id text not null default auth.user_id(),
  state jsonb not null check (pg_column_size(state) <= 16384),
  updated_at timestamptz not null default now(),
  foreign key (conversation_id, user_id) references public.conversations (id, user_id) on delete cascade
);

-- One workspace draft per user.
create table public.workspaces (
  user_id text primary key default auth.user_id(),
  problem text not null default '' check (char_length(problem) <= 1000),
  draft text not null default '' check (char_length(draft) <= 4000),
  updated_at timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger conversations_touch before update on public.conversations
  for each row execute function public.touch_updated_at();
create trigger learning_states_touch before update on public.learning_states
  for each row execute function public.touch_updated_at();
create trigger workspaces_touch before update on public.workspaces
  for each row execute function public.touch_updated_at();
create trigger messages_touch_conversation after insert on public.messages
  for each row execute function public.touch_conversation();

-- Row-level security: a signed-in user sees and changes only their own rows.
alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.learning_states enable row level security;
alter table public.workspaces enable row level security;

create policy own_rows on public.profiles for all to authenticated
  using (user_id = (select auth.user_id())) with check (user_id = (select auth.user_id()));
create policy own_rows on public.conversations for all to authenticated
  using (user_id = (select auth.user_id())) with check (user_id = (select auth.user_id()));
create policy own_rows on public.messages for all to authenticated
  using (user_id = (select auth.user_id())) with check (user_id = (select auth.user_id()));
create policy own_rows on public.learning_states for all to authenticated
  using (user_id = (select auth.user_id())) with check (user_id = (select auth.user_id()));
create policy own_rows on public.workspaces for all to authenticated
  using (user_id = (select auth.user_id())) with check (user_id = (select auth.user_id()));

-- Table privileges. Messages are never edited, only added or deleted.
-- Enabling the Data API may grant everything by default, so this is explicit.
revoke all on public.profiles, public.conversations, public.messages,
  public.learning_states, public.workspaces from public;
grant select, insert, update, delete on public.profiles, public.conversations,
  public.learning_states, public.workspaces to authenticated;
grant select, insert, delete on public.messages to authenticated;
revoke update on public.messages from authenticated;

-- Guests use no stored data, so the anonymous role, where it exists, gets nothing.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anonymous') then
    execute 'revoke all on public.profiles, public.conversations, public.messages,
      public.learning_states, public.workspaces from anonymous';
  end if;
end;
$$;

commit;
