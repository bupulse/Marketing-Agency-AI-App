-- An app User exists only while its Supabase Auth user exists. Deleting someone in
-- Supabase → Authentication → Users now also deletes their User row (and, through the
-- existing cascades, their business, subscription, usage, projects, leads and connections),
-- so a deleted address can sign up again.

-- Remove app users whose Auth user was already deleted.
DELETE FROM public."User" u WHERE NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = u.id);

ALTER TABLE public."User"
  ADD CONSTRAINT "User_id_auth_users_fkey"
  FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE;
