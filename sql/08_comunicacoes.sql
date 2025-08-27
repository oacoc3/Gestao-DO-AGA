-- comunicacoes_externas.sql
-- Controle de comunicações externas (ANAC, GABAER, Prefeitura, JJAER)

alter table if exists public.processos
  add column if not exists comunicacoes_a_expedir text[] not null default array[]::text[],
  add column if not exists comunicacoes_pendentes text[] not null default array[]::text[];

alter table if exists public.status_history
  add column if not exists comunicacao_solicitada text[],
  add column if not exists comunicacao_expedida text[],
  add column if not exists comunicacao text[];

create or replace function public.request_comunicacao(
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
begin
  update public.processos
    set comunicacoes_a_expedir = coalesce(
        (
          select array_agg(distinct unnest)
          from unnest(coalesce(comunicacoes_a_expedir, '{}') || coalesce(p_orgaos, '{}')) as unnest
        ),
        '{}'
      )
    where id = p_processo_id;

  insert into public.status_history (processo_id, comunicacao_solicitada, changed_by, changed_by_email)
  values (p_processo_id, p_orgaos, v_uid, v_email);
end;
$$;

create or replace function public.expedir_comunicacao(
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
    set comunicacoes_a_expedir = array_remove(comunicacoes_a_expedir, p_orgao),
        comunicacoes_pendentes = (
          select array_agg(distinct unnest)
          from unnest(coalesce(comunicacoes_pendentes, '{}') || array[p_orgao]) as unnest
        )
    where id = p_processo_id;

  insert into public.status_history (processo_id, comunicacao_expedida, changed_by, changed_by_email)
  values (p_processo_id, array[p_orgao], v_uid, v_email);
end;
$$;

create or replace function public.receive_comunicacao(
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
    set comunicacoes_pendentes = array_remove(comunicacoes_pendentes, p_orgao)
    where id = p_processo_id;

  insert into public.status_history (processo_id, comunicacao, changed_by, changed_by_email)
  values (p_processo_id, array[p_orgao], v_uid, v_email);
end;
$$;

grant execute on function public.request_comunicacao(bigint, text[]) to authenticated;
grant execute on function public.expedir_comunicacao(bigint, text) to authenticated;
grant execute on function public.receive_comunicacao(bigint, text) to authenticated;
