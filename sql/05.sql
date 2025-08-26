-- request_parecer.sql
-- Adiciona coluna de controle para pareceres pendentes e função RPC para solicitá-los

-- Garante que a tabela de processos possua a coluna para marcar pendência de parecer
alter table if exists public.processos
  add column if not exists parecer_pendente boolean not null default false;

-- Função chamada pelo front-end para sinalizar que um parecer foi solicitado
create or replace function public.request_parecer(
  p_processo_id bigint,
  p_orgao text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Marca o processo com flag de parecer pendente
  update public.processos
    set parecer_pendente = true
    where id = p_processo_id;

  -- Caso exista uma tabela de tarefas de processo, uma inserção poderia ser feita aqui
  -- ex.: insert into public.process_tasks (processo_id, tipo, orgao)
  --      values (p_processo_id, 'PARECER', p_orgao);
end;
$$;

grant execute on function public.request_parecer(bigint, text) to authenticated;
