-- profiles.sql
-- Tabela auxiliar para dados de usuários gerenciados via Supabase Auth

create table if not exists public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text not null unique,
  full_name           text,
  nome_guerra         text,
  posto_graduacao     text,
  perfil              text not null default 'Visitante',
  must_change_password boolean not null default true,
  created_at          timestamptz not null default timezone('utc', now()),
  updated_at          timestamptz not null default timezone('utc', now())
);

-- Função para manter timestamps
create or replace function public.set_profiles_timestamps()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    new.created_at := timezone('utc', now());
  end if;
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create trigger profiles_timestamps
before insert or update on public.profiles
for each row execute procedure public.set_profiles_timestamps();

-- RLS: cada usuário só vê/altera o próprio profile
alter table public.profiles enable row level security;
create policy "Self select" on public.profiles
  for select using (auth.uid() = id);
create policy "Self update" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);
