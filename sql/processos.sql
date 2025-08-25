-- processos.sql
-- Estrutura principal para os processos acompanhados pelo sistema

create table if not exists public.processos (
  id               bigserial primary key,
  nup              text not null unique,
  tipo             text not null,
  status           text not null,
  entrada_regional date,
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now()),
  modificado_por   text
);

-- Função para manter campos de auditoria
create or replace function public.set_processos_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    new.created_at := timezone('utc', now());
  end if;
  new.updated_at := timezone('utc', now());
  new.modificado_por := coalesce(current_setting('request.jwt.claims', true)::json->>'email', new.modificado_por);
  return new;
end;
$$;

create trigger processos_audit
before insert or update on public.processos
for each row execute procedure public.set_processos_audit();

-- Trigger que grava histórico de status
create trigger processos_status_history
after insert or update on public.processos
for each row execute procedure public.log_status_change();

-- RLS: somente usuários autenticados podem manipular
alter table public.processos enable row level security;
create policy "Authenticated read" on public.processos
  for select using (auth.role() = 'authenticated');
create policy "Authenticated insert" on public.processos
  for insert with check (auth.role() = 'authenticated');
create policy "Authenticated update" on public.processos
  for update using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
create policy "Authenticated delete" on public.processos
  for delete using (auth.role() = 'authenticated');
