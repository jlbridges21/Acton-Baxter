-- Prompt 2: GoHighLevel controlled writes with confirmation workflow.
-- Pending actions require explicit user confirmation before execution.

create table if not exists public.ghl_pending_actions (
  id uuid primary key default gen_random_uuid(),
  
  -- Actor identification (who initiated the action)
  user_id uuid references public.profiles (id) on delete set null,
  external_user_id text, -- Slack user ID or other external identifier
  
  -- Conversation context
  conversation_id uuid, -- Baxter conversation ID if from chat
  channel text not null check (channel in ('web', 'slack', 'api')),
  
  -- Action details
  action_type text not null check (action_type in (
    'update_contact_fields',
    'add_contact_tag',
    'remove_contact_tag',
    'update_opportunity',
    'move_opportunity_stage'
  )),
  resource_type text not null check (resource_type in ('contact', 'opportunity')),
  resource_id text not null, -- GHL resource ID
  resource_name text, -- Display name for UI
  
  -- State tracking for stale detection
  before_state jsonb not null default '{}'::jsonb, -- Snapshot at proposal time
  proposed_changes jsonb not null default '{}'::jsonb, -- What will be changed
  
  -- Workflow status
  status text not null default 'pending' check (status in (
    'pending',      -- Awaiting user confirmation
    'confirmed',    -- User confirmed, ready to execute
    'executing',    -- Currently executing
    'completed',    -- Successfully executed
    'failed',       -- Execution failed
    'expired',      -- Confirmation window closed
    'cancelled',    -- User cancelled
    'stale'         -- Resource changed since proposal
  )),
  
  -- Timing
  expires_at timestamptz not null default (timezone('utc', now()) + interval '10 minutes'),
  created_at timestamptz not null default timezone('utc', now()),
  confirmed_at timestamptz,
  executed_at timestamptz,
  
  -- Error tracking
  error_code text,
  error_message text,
  
  -- Additional metadata
  metadata jsonb not null default '{}'::jsonb
);

-- Indexes for common queries
create index if not exists ghl_pending_actions_status_idx
  on public.ghl_pending_actions (status, expires_at);

create index if not exists ghl_pending_actions_user_idx
  on public.ghl_pending_actions (user_id, created_at desc);

create index if not exists ghl_pending_actions_conversation_idx
  on public.ghl_pending_actions (conversation_id, created_at desc);

create index if not exists ghl_pending_actions_resource_idx
  on public.ghl_pending_actions (resource_type, resource_id);

-- Trigger for updated_at (reuse existing function)
create trigger ghl_pending_actions_set_updated_at
  before update on public.ghl_pending_actions
  for each row execute function public.set_updated_at();

-- Row Level Security
alter table public.ghl_pending_actions enable row level security;

-- Admins can read all pending actions
create policy "Admins can read ghl pending actions"
  on public.ghl_pending_actions for select
  to authenticated
  using (public.is_admin());

-- Users can read their own pending actions
create policy "Users can read own ghl pending actions"
  on public.ghl_pending_actions for select
  to authenticated
  using (user_id = auth.uid());

-- No direct client inserts/updates/deletes (service role only)
create policy "No client inserts to ghl pending actions"
  on public.ghl_pending_actions for insert
  to authenticated
  with check (false);

create policy "No client updates to ghl pending actions"
  on public.ghl_pending_actions for update
  to authenticated
  using (false);

create policy "No client deletes to ghl pending actions"
  on public.ghl_pending_actions for delete
  to authenticated
  using (false);

comment on table public.ghl_pending_actions is
  'GoHighLevel pending write actions awaiting user confirmation. Service role manages lifecycle.';

-- Extend ghl_action_audit for Prompt 2 (add proposed/execute tracking)
alter table public.ghl_action_audit
  add column if not exists pending_action_id uuid references public.ghl_pending_actions (id) on delete set null,
  add column if not exists channel text,
  add column if not exists external_user_id text,
  add column if not exists proposed_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists executed_at timestamptz;

-- Update status check constraint to include new statuses
alter table public.ghl_action_audit
  drop constraint if exists ghl_action_audit_status_check;

alter table public.ghl_action_audit
  add constraint ghl_action_audit_status_check
  check (status in ('planned', 'pending_approval', 'proposed', 'confirmed', 'executing', 'succeeded', 'failed', 'cancelled', 'expired', 'stale'));

-- Index for pending action lookups
create index if not exists ghl_action_audit_pending_idx
  on public.ghl_action_audit (pending_action_id);

comment on column public.ghl_action_audit.pending_action_id is
  'Reference to the pending action that triggered this audit entry.';
