-- Surveys: build a survey, share a public link, see results.
--
-- Run this by hand in the Baxter SQL editor. Do not apply it through the
-- Cursor Supabase connector — that project is not Baxter.
--
-- Access model:
--   * Authenticated app users (user, admin, super_admin) can read non-deleted
--     surveys and their questions, responses, and answers.
--   * There are no insert/update/delete policies. Every write goes through
--     server route handlers using the service role, which enforce
--     "creator or admin" for edits and deletes.
--   * anon has no table access. The public respondent page (/s/[token]) reads
--     and submits through service-role route handlers.

create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  public_token text not null,
  display_mode text not null default 'all_on_one_page'
    check (display_mode in ('all_on_one_page', 'one_at_a_time')),
  identity_mode text not null default 'name_optional'
    check (identity_mode in ('anonymous', 'name_optional', 'name_required')),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz
);

create unique index if not exists surveys_public_token_idx on public.surveys (public_token);
create index if not exists surveys_created_by_idx on public.surveys (created_by);
create index if not exists surveys_created_at_idx on public.surveys (created_at desc)
  where deleted_at is null;

drop trigger if exists surveys_set_updated_at on public.surveys;
create trigger surveys_set_updated_at
  before update on public.surveys
  for each row execute function public.set_updated_at();

comment on table public.surveys is
  'Surveys shared by public link. Readable by app users; written only by service-role route handlers.';
comment on column public.surveys.public_token is
  'Unguessable nanoid used in the public link /s/{token}.';
comment on column public.surveys.deleted_at is
  'Soft delete. Deleted surveys are hidden from lists and the public link stops working.';

create table if not exists public.survey_questions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys (id) on delete cascade,
  position integer not null default 0,
  prompt text not null,
  help_text text,
  type text not null
    check (type in ('star_rating', 'text', 'dropdown', 'multi_select')),
  required boolean not null default false,
  options jsonb not null default '[]'::jsonb
    check (jsonb_typeof(options) = 'array'),
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists survey_questions_survey_position_idx
  on public.survey_questions (survey_id, position);

comment on column public.survey_questions.options is
  'Array of {id, label} for dropdown and multi_select. Answers reference option id, not label.';
comment on column public.survey_questions.archived_at is
  'Set when a question with answers is removed. Archived questions stay in results under "Removed questions".';

create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys (id) on delete cascade,
  submitted_at timestamptz not null default timezone('utc', now()),
  respondent_user_id uuid references public.profiles (id) on delete set null,
  respondent_name text,
  respondent_email text
);

create index if not exists survey_responses_survey_submitted_idx
  on public.survey_responses (survey_id, submitted_at desc);
create index if not exists survey_responses_respondent_user_id_idx
  on public.survey_responses (respondent_user_id);

comment on table public.survey_responses is
  'One row per submission. Anonymous surveys never store respondent_user_id, name, or email.';

create table if not exists public.survey_answers (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.survey_responses (id) on delete cascade,
  question_id uuid not null references public.survey_questions (id) on delete cascade,
  rating_value integer check (rating_value between 1 and 5),
  text_value text check (text_value is null or char_length(text_value) <= 5000),
  option_ids text[]
);

create unique index if not exists survey_answers_response_question_idx
  on public.survey_answers (response_id, question_id);
create index if not exists survey_answers_question_id_idx
  on public.survey_answers (question_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.surveys enable row level security;
alter table public.survey_questions enable row level security;
alter table public.survey_responses enable row level security;
alter table public.survey_answers enable row level security;

drop policy if exists "App users can read surveys" on public.surveys;
drop policy if exists "App users can read survey questions" on public.survey_questions;
drop policy if exists "App users can read survey responses" on public.survey_responses;
drop policy if exists "App users can read survey answers" on public.survey_answers;

-- The uid call is wrapped in a scalar subquery so Postgres plans it once.
create policy "App users can read surveys"
  on public.surveys for select
  to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  );

create policy "App users can read survey questions"
  on public.survey_questions for select
  to authenticated
  using (
    exists (
      select 1 from public.surveys s
      where s.id = survey_questions.survey_id
        and s.deleted_at is null
    )
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  );

create policy "App users can read survey responses"
  on public.survey_responses for select
  to authenticated
  using (
    exists (
      select 1 from public.surveys s
      where s.id = survey_responses.survey_id
        and s.deleted_at is null
    )
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  );

create policy "App users can read survey answers"
  on public.survey_answers for select
  to authenticated
  using (
    exists (
      select 1
      from public.survey_responses r
      join public.surveys s on s.id = r.survey_id
      where r.id = survey_answers.response_id
        and s.deleted_at is null
    )
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  );

revoke all on public.surveys from anon;
revoke all on public.survey_questions from anon;
revoke all on public.survey_responses from anon;
revoke all on public.survey_answers from anon;
