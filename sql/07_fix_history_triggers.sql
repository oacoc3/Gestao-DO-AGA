-- Corrige violação de FK no status_history:
-- - BEFORE: define metadados (updated_at, modificado_por)
-- - AFTER: grava histórico (criação e mudanças), com autor (UUID e e-mail)

begin;

-- 1) Remover trigger/função antigos (se existirem)
drop trigger if exists trg_processos_status_history on public.processos;
drop function if exists public.fn_processos_status_history();

-- 2) Função BEFORE: só metadados
create or replace function public.fn_processos_set_meta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- quem está criando/alterando
  NEW.modificado_por := v_uid;

  -- timestamp de atualização
  if TG_OP = 'INSERT' then
    if NEW.updated_at is null then
      NEW.updated_at := now();
    end if;
  else
    NEW.updated_at := now();
  end if;

  return NEW;
end;
$$;

-- 3) Função AFTER: grava histórico (criação e mudanças)
create or replace function public.fn_processos_log_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
begin
  -- tenta obter e-mail do autor
  begin
    select email into v_email from auth.users where id = v_uid;
  exception when others then
    v_email := null;
  end;

  if TG_OP = 'INSERT' then
    -- criação: old_status = null, new_status = status inicial
    insert into public.status_history
      (processo_id, old_status, new_status, changed_by, changed_by_email)
    values
      (NEW.id, null, NEW.status, v_uid, v_email);

    return null;
  elsif TG_OP = 'UPDATE' then
    -- mudança de status
    if NEW.status is distinct from OLD.status then
      insert into public.status_history
        (processo_id, old_status, new_status, changed_by, changed_by_email)
      values
        (NEW.id, OLD.status, NEW.status, v_uid, v_email);
    end if;

    return null;
  end if;

  return null;
end;
$$;

-- 4) Criar triggers
create trigger trg_processos_set_meta
before insert or update on public.processos
for each row
execute function public.fn_processos_set_meta();

create trigger trg_processos_log_history
after insert or update on public.processos
for each row
execute function public.fn_processos_log_history();

commit;
