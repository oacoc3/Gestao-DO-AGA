-- Ativa RLS (Row Level Security)
alter table public.processos enable row level security;
alter table public.status_history enable row level security;

-- Políticas simples: qualquer usuário autenticado pode ler e escrever
-- (ajuste conforme sua necessidade de perfis)
drop policy if exists processos_select on public.processos;
create policy processos_select
on public.processos
for select
to authenticated
using (true);

drop policy if exists processos_insert on public.processos;
create policy processos_insert
on public.processos
for insert
to authenticated
with check (true);

drop policy if exists processos_update on public.processos;
create policy processos_update
on public.processos
for update
to authenticated
using (true)
with check (true);

drop policy if exists sh_select on public.status_history;
create policy sh_select
on public.status_history
for select
to authenticated
using (true);
