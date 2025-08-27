-- request_sigadaer.sql
-- Função para registrar necessidade de SIGADAER

create or replace function public.request_sigadaer(
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
    set pareceres_a_expedir = coalesce(
        (
          select array_agg(distinct unnest)
          from unnest(coalesce(pareceres_a_expedir, '{}') || array[p_orgao]) as unnest
        ),
        '{}'
      )
    where id = p_processo_id;

  insert into public.status_history (processo_id, comunicacao_solicitada, changed_by, changed_by_email)
  values (p_processo_id, array[p_orgao], v_uid, v_email);
end;
$$;

grant execute on function public.request_sigadaer(bigint, text) to authenticated;
