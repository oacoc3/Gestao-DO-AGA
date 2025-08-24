-- ===========================================
-- 01_SETUP.sql  (estrutura usada pela SPA)
-- ===========================================
begin;

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

-- ============================
-- TRIGGERS em processos
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

-- ============================
-- RLS (Row-Level Security)
-- ============================
alter table public.processos      enable row level security;
alter table public.status_history enable row level security;

-- Políticas mínimas, conforme a SPA:
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

-- status_history: somente leitura para AUTENTICADOS (inserções vêm do TRIGGER, com SECURITY DEFINER)
drop policy if exists sh_select on public.status_history;
create policy sh_select
on public.status_history
for select
to authenticated
using (true);

commit;
