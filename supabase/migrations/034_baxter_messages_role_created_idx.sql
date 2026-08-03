-- Speed date-ranged Baxter inquiry counts (assistant messages by created_at).
create index if not exists baxter_messages_role_created_idx
  on public.baxter_messages (role, created_at desc);
