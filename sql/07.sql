-- expedir_sigadaer.sql
-- Controle de pareceres a expedir e função para expedição

alter table if exists public.processos
  add column if not exists pareceres_a_expedir text[] not null default array[]::text[];

alter table if exists public.status_history
  add column if not exists parecer_expedido text[];

create or replace function public.request_parecer(
  p_processo_id bigint,
  p_orgaos text[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := current_setting('request.jwt.claims', true)::json->>'email';
  v_expedir text[] := array[]::text[];
  v_pender text[] := array[]::text[];
begin
  select array_agg(o) filter (where o in ('COMAE','COMGAP','COMPREP')),
         array_agg(o) filter (where o not in ('COMAE','COMGAP','COMPREP'))
    into v_expedir, v_pender
    from unnest(coalesce(p_orgaos, '{}')) as s(o);

  update public.processos
    set pareceres_a_expedir = (
      select array_agg(distinct unnest)
      from unnest(coalesce(pareceres_a_expedir, '{}') || coalesce(v_expedir, '{}')) as unnest
    ),
        pareceres_pendentes = (
      select array_agg(distinct unnest)
      from unnest(coalesce(pareceres_pendentes, '{}') || coalesce(v_pender, '{}')) as unnest
    )
    where id = p_processo_id;

  insert into public.status_history (processo_id, parecer_solicitado, changed_by, changed_by_email)
  values (p_processo_id, p_orgaos, v_uid, v_email);
end;
$$;

create or replace function public.expedir_sigadaer(
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
    set pareceres_a_expedir = array_remove(pareceres_a_expedir, p_orgao),
        pareceres_pendentes = (
          select array_agg(distinct unnest)
          from unnest(coalesce(pareceres_pendentes, '{}') || array[p_orgao]) as unnest
        )
    where id = p_processo_id;

  insert into public.status_history (processo_id, parecer_expedido, changed_by, changed_by_email)
  values (p_processo_id, array[p_orgao], v_uid, v_email);
end;
$$;

grant execute on function public.request_parecer(bigint, text[]) to authenticated;
grant execute on function public.expedir_sigadaer(bigint, text) to authenticated;
