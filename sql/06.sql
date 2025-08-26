-- receive_parecer.sql
-- Remove parecer solicitado e registra recebimento no histórico
alter table if exists public.status_history
  add column if not exists parecer text[];

create or replace function public.receive_parecer(
  p_processo_id bigint,
  p_orgao text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := current_setting('request.jwt.claims', true)::json->>'email';
begin
  update public.processos
    set pareceres_pendentes = array_remove(pareceres_pendentes, p_orgao)
    where id = p_processo_id;

  insert into public.status_history (processo_id, parecer, changed_by, changed_by_email)
  values (p_processo_id, array[p_orgao], v_uid, v_email);
end;
$$;

grant execute on function public.receive_parecer(bigint, text) to authenticated;
