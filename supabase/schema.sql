-- LuluSchemer schema. Paste into Supabase → SQL Editor → Run (safe to re-run).
-- Every row belongs to the signed-in user; row-level security enforces it.
-- Nested canvas / chat data stays jsonb: it is only ever read and written whole.

create table if not exists public.projects (
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  id          text not null,
  name        text not null,
  description text not null default '',
  color       text not null,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.tasks (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  id         text not null,
  project_id text,
  object_id  text,
  title      text not null,
  completed  boolean not null default false,
  priority   text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  due_date   date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.canvases (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  id         text not null,
  project_id text not null,
  viewport   jsonb not null,
  layers     jsonb not null,
  objects    jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.conversations (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  id         text not null, -- project id, or 'global' for the dashboard chat
  project_id text,
  messages   jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Row-level security: you can only see and change your own rows.
do $$
declare t text;
begin
  foreach t in array array['projects', 'tasks', 'canvases', 'conversations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

-- Private bucket for screenshots and canvas images, stored under <user id>/<file id>.
insert into storage.buckets (id, name, public) values ('files', 'files', false)
on conflict (id) do nothing;

drop policy if exists "own files select" on storage.objects;
drop policy if exists "own files insert" on storage.objects;
drop policy if exists "own files update" on storage.objects;
drop policy if exists "own files delete" on storage.objects;

create policy "own files select" on storage.objects for select to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own files insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own files update" on storage.objects for update to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
