-- Habilita extensão para UUID
create extension if not exists pgcrypto;

-- Tabela principal
create table if not exists public.processos (
  id uuid primary key default gen_random_uuid(),
  nup text not null unique,
  tipo text not null check (tipo in ('PDIR','Inscrição/Alteração','Exploração','OPEA')),
  status text not null,
  entrada_regional date,
  prazo_saida_regional date,
  saida_regional date,
  modificado_por uuid, -- armazenamos o auth.uid() do usuário
  updated_at timestamptz not null default now()
);

-- Histórico de status
create table if not exists public.status_history (
  id bigserial primary key,
  processo_id uuid not null references public.processos(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_at timestamptz not null default now(),
  changed_by uuid
);

-- Trigger para registrar histórico e atualizar campos
create or replace function public.fn_processos_status_history()
returns trigger
language plpgsql
security definer
as $$
declare
  v_uid uuid := auth.uid(); -- id do usuário autenticado atual
begin
  -- quando o status muda, registra no histórico
  if TG_OP = 'UPDATE' and NEW.status is distinct from OLD.status then
    insert into public.status_history(processo_id, old_status, new_status, changed_by)
    values (OLD.id, OLD.status, NEW.status, v_uid);
  end if;

  -- atualiza metadados
  NEW.updated_at := now();
  NEW.modificado_por := v_uid;

  return NEW;
end;
$$;

drop trigger if exists trg_processos_status_history on public.processos;
create trigger trg_processos_status_history
before update on public.processos
for each row
execute function public.fn_processos_status_history();
