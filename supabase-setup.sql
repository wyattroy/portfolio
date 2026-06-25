-- ============================================================
-- wyattroy.com — Comment system setup
-- Run this in the Supabase SQL Editor:
-- app.supabase.com → your project → SQL Editor → New query
-- ============================================================

-- Comments table
create table if not exists public.comments (
  id            uuid        not null default gen_random_uuid() primary key,
  project_id    text        not null,
  name          text        not null check (char_length(name)    between 1 and 100),
  email         text        not null check (char_length(email)   between 1 and 200),
  link          text        not null default '' check (char_length(link) <= 500),
  comment       text        not null check (char_length(comment) between 1 and 2000),
  approved      boolean     not null default false,
  hidden        boolean     not null default false,
  browser_token text        not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_comments_project
  on public.comments (project_id, approved, hidden, created_at);

-- Row Level Security
alter table public.comments enable row level security;

-- Anon: read approved, non-hidden comments only
create policy "public_read" on public.comments
  for select to anon
  using (approved = true and hidden = false);

-- Anon: submit new comments
create policy "public_insert" on public.comments
  for insert to anon
  with check (true);

-- Authenticated (admin): full access
create policy "admin_full" on public.comments
  for all to authenticated
  using (true)
  with check (true);

-- RPC: lets a visitor edit their own comment using the browser token
-- stored in their localStorage. security definer bypasses RLS and
-- validates the token server-side instead.
create or replace function public.edit_comment_by_token(
  p_id       uuid,
  p_token    text,
  p_name     text,
  p_comment  text,
  p_link     text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.comments
  set
    name       = left(trim(p_name),    100),
    comment    = left(trim(p_comment), 2000),
    link       = left(trim(p_link),    500),
    updated_at = now()
  where id            = p_id
    and browser_token = p_token;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- Grant anon users the ability to call the RPC
grant execute on function public.edit_comment_by_token to anon;

-- ============================================================
-- After running this SQL:
-- 1. Go to Authentication → Users → Add user
--    Enter your email + a strong password for the admin portal.
-- 2. Copy your Project URL and anon key from Settings → API.
-- 3. Paste both into SUPABASE_URL and SUPABASE_ANON_KEY in:
--      project.html  (public comment wall + form)
--      admin.html    (admin portal)
-- ============================================================
