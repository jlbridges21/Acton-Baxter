-- Free-text department label for Baxter feedback reporting (and /admin/users editing).
-- Structured departments (department_id → departments) remain from migration 026;
-- feedback filters prefer department_id→name, then fall back to this text column.
alter table public.profiles
  add column if not exists department text;

create index if not exists profiles_department_text_idx
  on public.profiles (department)
  where department is not null and length(trim(department)) > 0;

-- Asker lookups for the inquiry dashboard.
create index if not exists baxter_conversations_external_user_id_idx
  on public.baxter_conversations (external_user_id)
  where external_user_id is not null;
