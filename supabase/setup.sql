-- setup.sql - Reseta e configura o Supabase para o projeto Gestao-DO-AGA

-- =========================
-- Extensões
-- =========================
create extension if not exists "pgcrypto";

-- =========================
-- Limpeza de objetos existentes
-- =========================
-- Remove tabelas customizadas
 drop table if exists public.status_history cascade;
 drop table if exists public.processos cascade;
 drop table if exists public.profiles cascade;
-- Remove tipo enumerado de perfil
 drop type if exists public.perfil_type;
-- Remove usuários existentes do Auth
 delete from auth.users;
-- Remove trigger e função de sincronização de perfis
 drop trigger if exists on_auth_user_created on auth.users;
 drop function if exists public.handle_new_user();

-- =========================
-- Tipo enumerado de perfis de usuário
-- =========================
create type public.perfil_type as enum (
  'Administrador',
  'CH AGA',
  'CH OACO',
  'CH OAGA',
  'Analista OACO',
  'Analista OAGA',
  'Visitante'
);

-- =========================
-- Tabela de perfis
-- =========================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  nome_guerra text,
  posto_graduacao text,
  perfil public.perfil_type not null default 'Visitante',
  must_change_password boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_self_select" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = id);

-- =========================
-- Tabela de processos
-- =========================
create table public.processos (
  id uuid primary key default gen_random_uuid(),
  nup text not null unique,
  tipo text not null,
  entrada_regional date,
  status text,
  modificado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.processos enable row level security;

create policy "proc_select" on public.processos
  for select using (auth.role() = 'authenticated');
create policy "proc_insert" on public.processos
  for insert with check (auth.role() = 'authenticated');
create policy "proc_update" on public.processos
  for update using (auth.role() = 'authenticated');
create policy "proc_delete" on public.processos
  for delete using (auth.role() = 'authenticated');

-- =========================
-- Tabela de histórico de status
-- =========================
create table public.status_history (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.processos(id) on delete cascade,
  old_status text,
  new_status text,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id),
  changed_by_email text
);

alter table public.status_history enable row level security;

create policy "hist_select" on public.status_history
  for select using (auth.role() = 'authenticated');
create policy "hist_insert" on public.status_history
  for insert with check (auth.role() = 'authenticated');

-- =========================
-- Triggers para processos
-- =========================
create or replace function public.set_processos_metadata()
returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    new.created_at := now();
  end if;
  new.updated_at := now();
  new.modificado_por := coalesce(auth.jwt()->>'email', new.modificado_por);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger processos_metadata
  before insert or update on public.processos
  for each row execute function public.set_processos_metadata();

create or replace function public.log_status_change()
returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.status_history (processo_id, old_status, new_status, changed_by, changed_by_email)
    values (new.id, null, new.status, auth.uid(), auth.jwt()->>'email');
  elsif (new.status is distinct from old.status) then
    insert into public.status_history (processo_id, old_status, new_status, changed_by, changed_by_email)
    values (new.id, old.status, new.status, auth.uid(), auth.jwt()->>'email');
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger processos_status
  after insert or update on public.processos
  for each row execute function public.log_status_change();

-- =========================
-- Trigger para sincronizar perfis ao criar usuário no Auth
-- =========================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, nome_guerra, posto_graduacao, perfil, must_change_password)
  values (new.id,
          new.email,
          new.raw_user_meta_data->>'full_name',
          new.raw_user_meta_data->>'nome_guerra',
          new.raw_user_meta_data->>'posto_graduacao',
          coalesce(new.raw_app_meta_data->>'perfil','Visitante'),
          true)
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        nome_guerra = excluded.nome_guerra,
        posto_graduacao = excluded.posto_graduacao,
        perfil = excluded.perfil;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Em vez de "create trigger" direto, faça assim:
do $$
begin
  if exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where t.tgname = 'on_auth_user_created'
      and n.nspname = 'auth'
      and c.relname = 'users'
  ) then
    drop trigger on_auth_user_created on auth.users;
  end if;

  create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
end $$;


-- =========================
-- (Removido) Usuário Administrador inicial
-- =========================
-- O Supabase atual não possui a função SQL auth.create_user(...)
-- O usuário inicial deve ser criado via Admin API (service_role) ou pelo Dashboard.
-- Ao criar o usuário, o trigger on_auth_user_created preencherá public.profiles.
-- Depois, se desejar, você pode limpar o must_change_password.

-- Exemplo (para rodar *depois* de criar o usuário via API/Dashboard):
-- update public.profiles
--   set must_change_password = false
--   where email = 'macedocsm@fab.mil.br';
