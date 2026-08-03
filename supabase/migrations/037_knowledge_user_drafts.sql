-- Knowledge Center: employees can create/view their own drafts;
-- approved+internal remains readable by all authenticated users.
-- created_by already exists on knowledge_entries (migration 006).

drop policy if exists "Employees can read approved internal knowledge"
  on public.knowledge_entries;

create policy "Employees can read approved internal or own drafts"
  on public.knowledge_entries for select
  to authenticated
  using (
    (status = 'approved' and visibility = 'internal')
    or (status = 'draft' and created_by = auth.uid())
  );

-- Non-admins may only insert drafts they authored (status forced to draft).
-- Admins retain the existing "Admins can insert knowledge entries" policy.
create policy "App users can insert own draft knowledge"
  on public.knowledge_entries for insert
  to authenticated
  with check (
    not public.is_admin()
    and status = 'draft'
    and created_by = auth.uid()
    and visibility = 'internal'
  );

-- Non-admins may update only their own drafts (cannot change status away from draft).
create policy "App users can update own draft knowledge"
  on public.knowledge_entries for update
  to authenticated
  using (
    not public.is_admin()
    and status = 'draft'
    and created_by = auth.uid()
  )
  with check (
    not public.is_admin()
    and status = 'draft'
    and created_by = auth.uid()
    and visibility = 'internal'
  );
