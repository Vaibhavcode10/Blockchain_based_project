create table if not exists public.question_bank (
  qid text primary key,
  record jsonb not null
);

create table if not exists public.question_papers (
  paper_id uuid primary key,
  record jsonb not null
);

create table if not exists public.app_users (
  user_id uuid primary key,
  email text not null unique,
  record jsonb not null
);

alter table public.question_bank enable row level security;
alter table public.question_papers enable row level security;
alter table public.app_users enable row level security;

revoke all on public.question_bank from anon, authenticated;
revoke all on public.question_papers from anon, authenticated;
revoke all on public.app_users from anon, authenticated;

grant all on public.question_bank to service_role;
grant all on public.question_papers to service_role;
grant all on public.app_users to service_role;