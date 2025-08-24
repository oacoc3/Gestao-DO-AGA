-- ===========================================
-- 00_RESET.sql  (limpa as estruturas da SPA)
-- ===========================================
begin;

-- Remover TRIGGERS (se existirem)
drop trigger if exists trg_processos_set_meta     on public.processos;
drop trigger if exists trg_processos_log_history  on public.processos;

-- Remover FUNÇÕES (se existirem)
drop function if exists public.fn_processos_set_meta();
drop function if exists public.fn_processos_log_history();

-- Remover POLÍTICAS (se existirem)
drop policy if exists processos_select on public.processos;
drop policy if exists processos_insert on public.processos;
drop policy if exists processos_update on public.processos;
drop policy if exists processos_delete on public.processos;

drop policy if exists sh_select   on public.status_history;
drop policy if exists sh_insert   on public.status_history;
drop policy if exists sh_update   on public.status_history;
drop policy if exists sh_delete   on public.status_history;

-- Desativar RLS antes de dropar (não é obrigatório, mas deixa limpo)
alter table if exists public.processos       disable row level security;
alter table if exists public.status_history  disable row level security;

-- Apagar TABELAS (status_history depende de processos)
drop table if exists public.status_history;
drop table if exists public.processos;

commit;
