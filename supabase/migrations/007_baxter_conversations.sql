-- Baxter conversation logging foundation (Prompt 3)
-- Shared web + future Slack conversation schema. No secrets or system prompts stored.

-- ---------------------------------------------------------------------------
-- baxter_conversations
-- ---------------------------------------------------------------------------
create table if not exists public.baxter_conversations (
  id uuid primary key default gen_random_uuid(),
  channel text not null
    check (channel in ('web', 'slack')),
  external_thread_id text,
  user_id uuid references public.profiles (id) on delete set null,
  external_user_id text,
  user_display_name text,
  status text not null default 'active'
    check (status in ('active', 'closed', 'error')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_message_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists baxter_conversations_user_id_idx
  on public.baxter_conversations (user_id, last_message_at desc nulls last);
create index if not exists baxter_conversations_channel_idx
  on public.baxter_conversations (channel, created_at desc);
create index if not exists baxter_conversations_external_thread_idx
  on public.baxter_conversations (external_thread_id)
  where external_thread_id is not null;

create trigger baxter_conversations_set_updated_at
  before update on public.baxter_conversations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- baxter_messages
-- ---------------------------------------------------------------------------
create table if not exists public.baxter_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.baxter_conversations (id) on delete cascade,
  role text not null
    check (role in ('user', 'assistant', 'system')),
  content text not null,
  insufficient_knowledge boolean not null default false,
  confidence text
    check (confidence is null or confidence in ('high', 'medium', 'low')),
  model_provider text,
  model_name text,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  error_code text,
  created_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists baxter_messages_conversation_idx
  on public.baxter_messages (conversation_id, created_at asc);

-- ---------------------------------------------------------------------------
-- baxter_message_sources
-- ---------------------------------------------------------------------------
create table if not exists public.baxter_message_sources (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null
    references public.baxter_messages (id) on delete cascade,
  knowledge_entry_id uuid not null
    references public.knowledge_entries (id) on delete restrict,
  source_order integer not null check (source_order >= 1),
  relevance_score double precision,
  created_at timestamptz not null default timezone('utc', now()),
  unique (message_id, knowledge_entry_id)
);

create index if not exists baxter_message_sources_message_idx
  on public.baxter_message_sources (message_id, source_order);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.baxter_conversations enable row level security;
alter table public.baxter_messages enable row level security;
alter table public.baxter_message_sources enable row level security;

-- Users: own web conversations
create policy "Users can read own web conversations"
  on public.baxter_conversations for select
  to authenticated
  using (
    channel = 'web'
    and user_id = auth.uid()
  );

create policy "Users can create own web conversations"
  on public.baxter_conversations for insert
  to authenticated
  with check (
    channel = 'web'
    and user_id = auth.uid()
  );

create policy "Users can update own web conversations"
  on public.baxter_conversations for update
  to authenticated
  using (
    channel = 'web'
    and user_id = auth.uid()
  )
  with check (
    channel = 'web'
    and user_id = auth.uid()
  );

-- Admins: all conversations (diagnostics)
create policy "Admins can read all conversations"
  on public.baxter_conversations for select
  to authenticated
  using (public.is_admin());

-- Messages: via conversation ownership
create policy "Users can read messages in own web conversations"
  on public.baxter_messages for select
  to authenticated
  using (
    exists (
      select 1
      from public.baxter_conversations c
      where c.id = conversation_id
        and c.channel = 'web'
        and c.user_id = auth.uid()
    )
  );

create policy "Users can insert messages in own web conversations"
  on public.baxter_messages for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.baxter_conversations c
      where c.id = conversation_id
        and c.channel = 'web'
        and c.user_id = auth.uid()
    )
  );

create policy "Admins can read all messages"
  on public.baxter_messages for select
  to authenticated
  using (public.is_admin());

-- Message sources: via message → conversation ownership
create policy "Users can read sources for own web messages"
  on public.baxter_message_sources for select
  to authenticated
  using (
    exists (
      select 1
      from public.baxter_messages m
      join public.baxter_conversations c on c.id = m.conversation_id
      where m.id = message_id
        and c.channel = 'web'
        and c.user_id = auth.uid()
    )
  );

create policy "Users can insert sources for own web messages"
  on public.baxter_message_sources for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.baxter_messages m
      join public.baxter_conversations c on c.id = m.conversation_id
      where m.id = message_id
        and c.channel = 'web'
        and c.user_id = auth.uid()
    )
  );

create policy "Admins can read all message sources"
  on public.baxter_message_sources for select
  to authenticated
  using (public.is_admin());
