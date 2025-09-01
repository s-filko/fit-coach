-- Initial schema for Fit Coach (users, user_accounts)
create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text unique,
  gender text,
  height integer,
  height_unit text,
  weight_unit text,
  birth_year integer,
  fitness_goal text,
  tone text,
  reminder_enabled boolean default false,
  first_name text,
  last_name text,
  language_code text,
  created_at timestamp default now(),
  updated_at timestamp default now(),
  username text
);

create table if not exists user_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null,
  provider_user_id text not null,
  created_at timestamp default now(),
  updated_at timestamp default now(),
  unique(provider, provider_user_id)
);


