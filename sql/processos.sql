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
