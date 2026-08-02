-- Slack reaction feedback for Baxter answers + nullable feedback actors.
-- Slack reactors often have no Supabase profile — store slack_user_id instead
-- of inventing fake profiles (same precedent as SLACK_REPORT_USER_ID).

-- ---------------------------------------------------------------------------
-- baxter_messages: map Slack posts → assistant rows (for reaction lookup)
-- ---------------------------------------------------------------------------
alter table public.baxter_messages
  add column if not exists slack_channel_id text,
  add column if not exists slack_message_ts text;

create unique index if not exists baxter_messages_slack_ref_uidx
  on public.baxter_messages (slack_channel_id, slack_message_ts)
  where slack_channel_id is not null and slack_message_ts is not null;

-- ---------------------------------------------------------------------------
-- baxter_message_feedback: Slack actors + partial unique upserts
-- ---------------------------------------------------------------------------
alter table public.baxter_message_feedback
  alter column user_id drop not null;

alter table public.baxter_message_feedback
  add column if not exists slack_user_id text,
  add column if not exists slack_team_id text;

-- Drop the original unique(message_id, user_id) so partial indexes can replace it.
alter table public.baxter_message_feedback
  drop constraint if exists baxter_message_feedback_message_id_user_id_key;

alter table public.baxter_message_feedback
  drop constraint if exists baxter_message_feedback_actor_check;

alter table public.baxter_message_feedback
  add constraint baxter_message_feedback_actor_check
  check (user_id is not null or slack_user_id is not null);

create unique index if not exists baxter_message_feedback_message_user_uidx
  on public.baxter_message_feedback (message_id, user_id)
  where user_id is not null;

create unique index if not exists baxter_message_feedback_message_slack_uidx
  on public.baxter_message_feedback (message_id, slack_user_id)
  where slack_user_id is not null;

create index if not exists baxter_message_feedback_slack_user_idx
  on public.baxter_message_feedback (slack_user_id, created_at desc)
  where slack_user_id is not null;

-- RLS: existing policies keep working with nullable user_id.
-- Slack-originated writes use the service role (bypass RLS), same as other Slack paths.
-- Reaffirm select/update for authenticated web users (own rows only when user_id set).
drop policy if exists "Users can read own feedback" on public.baxter_message_feedback;
create policy "Users can read own feedback"
  on public.baxter_message_feedback for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Users can insert own feedback for accessible messages"
  on public.baxter_message_feedback;
create policy "Users can insert own feedback for accessible messages"
  on public.baxter_message_feedback for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.baxter_messages m
      join public.baxter_conversations c on c.id = m.conversation_id
      where m.id = message_id
        and m.role = 'assistant'
        and (
          c.user_id = auth.uid()
          or public.is_admin()
        )
    )
  );

drop policy if exists "Users can update own feedback" on public.baxter_message_feedback;
create policy "Users can update own feedback"
  on public.baxter_message_feedback for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
