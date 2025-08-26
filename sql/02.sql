-- status_history.sql
-- Tabela para registrar mudanças de status em processos

create table if not exists public.status_history (
  id            bigserial primary key,
  processo_id   bigint not null references public.processos(id) on delete cascade,
  old_status    text,
  new_status    text,
  changed_at    timestamptz not null default timezone('utc', now()),
  changed_by    uuid,
  changed_by_email text
);

-- Ativa RLS e permite consulta para usuários autenticados
alter table public.status_history enable row level security;
create policy "Authenticated read" on public.status_history
  for select using (auth.role() = 'authenticated');

-- Função que registra automaticamente o histórico
create or replace function public.log_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := current_setting('request.jwt.claims', true)::json->>'email';
begin
  if (tg_op = 'INSERT') then
    insert into public.status_history (processo_id, old_status, new_status, changed_by, changed_by_email)
    values (new.id, null, new.status, v_uid, v_email);
    return new;
  elsif (tg_op = 'UPDATE') then
    if new.status is distinct from old.status then
      insert into public.status_history (processo_id, old_status, new_status, changed_by, changed_by_email)
      values (new.id, old.status, new.status, v_uid, v_email);
    end if;
    return new;
  end if;
  return new;
end;
$$;
