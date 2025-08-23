-- 06_status_history_creation_and_user.sql
-- Objetivo:
-- - Registrar o ato de CRIAÇÃO no status_history
-- - Registrar o usuário (UUID e e-mail) em toda criação/modificação
-- Siglas:
-- - RLS: Row Level Security (Segurança em nível de linha)
-- - UUID: Universally Unique Identifier (Identificador único universal)

begin;

-- 1) Acrescenta coluna para armazenar o e-mail de quem realizou a ação
alter table if exists public.status_history
  add column if not exists changed_by_email text;

-- 2) Recria a função do trigger para tratar INSERT e UPDATE
create or replace function public.fn_processos_status_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();        -- UUID do usuário autenticado
  v_email text;
begin
  -- tenta obter o e-mail do usuário autenticado
  begin
    select email into v_email from auth.users where id = v_uid;
  exception when others then
    v_email := null;
  end;

  if TG_OP = 'INSERT' then
    -- criação do processo: registra histórico de criação
    NEW.updated_at := now();
    NEW.modificado_por := v_uid;

    insert into public.status_history (processo_id, old_status, new_status, changed_by, changed_by_email)
    values (NEW.id, null, NEW.status, v_uid, v_email);

    return NEW;
  elsif TG_OP = 'UPDATE' then
    -- alteração: se o status mudou, registra no histórico
    if NEW.status is distinct from OLD.status then
      insert into public.status_history (processo_id, old_status, new_status, changed_by, changed_by_email)
      values (OLD.id, OLD.status, NEW.status, v_uid, v_email);
    end if;

    NEW.updated_at := now();
    NEW.modificado_por := v_uid;

    return NEW;
  end if;

  return NEW;
end;
$$;

-- 3) Garante o trigger para INSERT e UPDATE
drop trigger if exists trg_processos_status_history on public.processos;
create trigger trg_processos_status_history
before insert or update on public.processos
for each row
execute function public.fn_processos_status_history();

commit;
