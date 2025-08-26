-- request_parecer.sql
-- Adiciona coluna para controlar pareceres pendentes e função RPC para solicitá-los

-- Garante que a tabela de processos possua a coluna para listar pareceres pendentes
alter table if exists public.processos
  add column if not exists pareceres_pendentes text[] not null default array[]::text[];

-- Função chamada pelo front-end para sinalizar que um ou mais pareceres foram solicitados
create or replace function public.request_parecer(
  p_processo_id bigint,
  p_orgaos text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.processos
    set pareceres_pendentes = (
      select array_agg(distinct unnest)
      from unnest(coalesce(pareceres_pendentes, '{}') || coalesce(p_orgaos, '{}')) as unnest
    )
    where id = p_processo_id;
end;
$$;

grant execute on function public.request_parecer(bigint, text[]) to authenticated;
