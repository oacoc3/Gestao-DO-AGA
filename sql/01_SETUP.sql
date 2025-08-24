-- ===========================================
-- 00_RESET_SETUP.sql  (reset + estrutura usada pela SPA)
-- ===========================================
begin;


-- Remover TRIGGERS (se existirem)
drop trigger if exists trg_processos_set_meta    on public.processos;
drop trigger if exists trg_processos_log_history on public.processos;
drop trigger if exists trg_profiles_set_timestamp on public.profiles;

-- Remover FUNÇÕES (se existirem)
drop function if exists public.fn_processos_set_meta();
drop function if exists public.fn_processos_log_history();
drop function if exists public.fn_profiles_set_timestamp();

-- Remover POLÍTICAS (se existirem)
drop policy if exists processos_select on public.processos;
drop policy if exists processos_insert on public.processos;
drop policy if exists processos_update on public.processos;
drop policy if exists processos_delete on public.processos;

drop policy if exists sh_select on public.status_history;
drop policy if exists sh_insert on public.status_history;
drop policy if exists sh_update on public.status_history;
drop policy if exists sh_delete on public.status_history;

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_delete on public.profiles;

-- Desativar RLS antes de dropar (não é obrigatório, mas deixa limpo)
alter table if exists public.processos      disable row level security;
alter table if exists public.status_history disable row level security;
alter table if exists public.profiles       disable row level security;

-- Apagar TABELAS (status_history depende de processos)
drop table if exists public.status_history;
drop table if exists public.processos;
drop table if exists public.profiles;

-- Extensão para gerar UUID (se já existir, não dá erro)
create extension if not exists pgcrypto;

-- ============================
-- TABELA PRINCIPAL: processos
-- ============================
create table public.processos (
  id                uuid primary key default gen_random_uuid(),  -- PK (UUID)
  nup               text not null unique,                         -- NUP (apenas dígitos; a SPA valida)
  tipo              text not null check (tipo in ('PDIR','Inscrição/Alteração','Exploração','OPEA')),
  status            text not null,
  entrada_regional  date,
  prazo_saida_regional date,  -- legado (a SPA calcula prazo em tela; mantido por compatibilidade)
  saida_regional    date,     -- legado (não usado hoje, mantido por compatibilidade)
  modificado_por    uuid,     -- armazena auth.uid() de quem alterou/criou
  updated_at        timestamptz not null default now()
);

-- Índices úteis para buscas e paginação
create index if not exists idx_processos_nup on public.processos (nup);
-- paginação/ordenação: updated_at desc, id desc
create index if not exists idx_processos_updated_id_desc
  on public.processos (updated_at desc, id desc);

-- ================================
-- HISTÓRICO DE STATUS: status_history
-- ================================
create table public.status_history (
  id                bigserial primary key,
  processo_id       uuid not null references public.processos(id) on delete cascade, -- FK
  old_status        text,
  new_status        text not null,
  changed_at        timestamptz not null default now(),
  changed_by        uuid,     -- auth.uid() de quem mudou/criou
  changed_by_email  text      -- e-mail de quem mudou/criou
);

-- Índices para histórico (listagem por processo e ordenação por data)
create index if not exists idx_sh_processo_changed_at
  on public.status_history (processo_id, changed_at desc);
create index if not exists idx_sh_processo on public.status_history (processo_id);

-- ============================
-- PERFIS DE USUÁRIOS: profiles
-- ============================
create table public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  email                text not null unique,
  full_name            text,
  nome_guerra          text,
  posto_graduacao      text,
  perfil               text not null check (perfil in ('Administrador','CH AGA','CH OACO','CH OAGA','Analista OACO','Analista OAGA','Visitante')),
  must_change_password boolean not null default false,
  updated_at           timestamptz not null default now()
);

create index if not exists idx_profiles_updated_id_desc
  on public.profiles (updated_at desc, id desc);

-- ============================
-- FUNÇÕES DE TRIGGER (PL/pgSQL)
-- ============================

-- BEFORE: define metadados (updated_at, modificado_por) em processos
create or replace function public.fn_processos_set_meta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- Atualiza metadados sempre
  new.updated_at   := now();
  new.modificado_por := v_uid;
  return new;
end;
$$;

-- AFTER: grava histórico (criação e mudança de status) com autor e e-mail
create or replace function public.fn_processos_log_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
begin
  -- Captura e-mail do usuário autenticado, se houver
  begin
    select u.email into v_email
      from auth.users u
     where u.id = v_uid;
  exception when others then
    v_email := null;
  end;

  if (tg_op = 'INSERT') then
    -- registra o ato de criação
    insert into public.status_history (processo_id, old_status, new_status, changed_at, changed_by, changed_by_email)
    values (new.id, null, new.status, now(), v_uid, v_email);

  elsif (tg_op = 'UPDATE') then
    -- registra apenas se o status tiver mudado
    if (new.status is distinct from old.status) then
      insert into public.status_history (processo_id, old_status, new_status, changed_at, changed_by, changed_by_email)
      values (new.id, old.status, new.status, now(), v_uid, v_email);
    end if;
  end if;

  return new;
end;
$$;

-- BEFORE: atualiza updated_at em profiles
create or replace function public.fn_profiles_set_timestamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ============================
-- TRIGGERS
-- ============================
-- BEFORE: metadados
create trigger trg_processos_set_meta
before insert or update on public.processos
for each row
execute function public.fn_processos_set_meta();

-- AFTER: histórico de criação/mudança
create trigger trg_processos_log_history
after insert or update on public.processos
for each row
execute function public.fn_processos_log_history();

-- BEFORE UPDATE: timestamp em profiles
create trigger trg_profiles_set_timestamp
before update on public.profiles
for each row
execute function public.fn_profiles_set_timestamp();

-- ============================
-- RLS (Row-Level Security)
-- ============================
alter table public.processos      enable row level security;
alter table public.status_history enable row level security;
alter table public.profiles       enable row level security;

-- processos: todos os usuários AUTENTICADOS podem listar/criar/atualizar/excluir
drop policy if exists processos_select on public.processos;
create policy processos_select
on public.processos
for select
to authenticated
using (true);

drop policy if exists processos_insert on public.processos;
create policy processos_insert
on public.processos
for insert
to authenticated
with check (true);

drop policy if exists processos_update on public.processos;
create policy processos_update
on public.processos
for update
to authenticated
using (true)
with check (true);

drop policy if exists processos_delete on public.processos;
create policy processos_delete
on public.processos
for delete
to authenticated
using (true);

-- status_history: somente leitura para AUTENTICADOS
drop policy if exists sh_select on public.status_history;
create policy sh_select
on public.status_history
for select
to authenticated
using (true);

-- profiles: cada usuário acessa apenas seu próprio registro
drop policy if exists profiles_select on public.profiles;
create policy profiles_select
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- ============================
-- Usuário Administrador padrão
-- ============================
do $$
declare
  v_uid uuid;
begin
  -- remove usuário existente (se houver)
  delete from auth.users where email = 'macedocsm@fab.mil.br';

  -- cria novo usuário no auth.users
  v_uid := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data)
  values (
    v_uid,
    'macedocsm@fab.mil.br',
    crypt('123456', gen_salt('bf')),
    now(),
    '{"perfil":"Administrador"}'
  );

  -- atribui perfil Administrador
  insert into public.profiles (id, email, perfil, must_change_password)
  values (v_uid, 'macedocsm@fab.mil.br', 'Administrador', true);
end
$$;

commit;
