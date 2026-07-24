-- Prompt 5C: Baxter answer feedback (lightweight)

create table if not exists public.baxter_message_feedback (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.baxter_messages (id) on delete cascade,
  conversation_id uuid not null references public.baxter_conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  rating text not null check (rating in ('up', 'down')),
  comment text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (message_id, user_id)
);

create index if not exists baxter_message_feedback_created_idx
  on public.baxter_message_feedback (created_at desc);

create index if not exists baxter_message_feedback_rating_idx
  on public.baxter_message_feedback (rating, created_at desc);

create trigger baxter_message_feedback_set_updated_at
  before update on public.baxter_message_feedback
  for each row execute function public.set_updated_at();

alter table public.baxter_message_feedback enable row level security;

create policy "Users can read own feedback"
  on public.baxter_message_feedback for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

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

create policy "Users can update own feedback"
  on public.baxter_message_feedback for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Admins can read all feedback"
  on public.baxter_message_feedback for select
  to authenticated
  using (public.is_admin());
