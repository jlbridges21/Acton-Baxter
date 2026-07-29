-- Slack channel directory: membership + archived flags for retrieval access decisions.
alter table public.slack_channel_profiles
  add column if not exists is_archived boolean not null default false;

alter table public.slack_channel_profiles
  add column if not exists is_member boolean;

comment on column public.slack_channel_profiles.is_archived is
  'True when Slack reports the channel as archived. Excluded from default retrieval.';
comment on column public.slack_channel_profiles.is_member is
  'Whether the bot token was a member at last directory refresh (may be stale).';
