// Creates (or finds) the confirmed Supabase auth users for the demo accounts. The app's own ensureAccount()
// then creates the User, Business, Membership and trial Subscription on the first sign-in.
import { createClient } from "@supabase/supabase-js";
import { ROOT } from "./db.mjs";
import { ACCOUNTS, PASSWORD } from "./accounts.mjs";
void ROOT;

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

export async function ensureAuthUser(email, user_metadata) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata });
  if (!error) return data.user.id;
  if (!/already/i.test(error.message)) throw error;
  for (let page = 1; ; page++) {
    const { data: list } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const found = list.users.find((u) => u.email === email);
    if (found) return found.id;
    if (list.users.length < 200) throw new Error(`not found: ${email}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [slug, a] of Object.entries(ACCOUNTS)) console.log(slug, await ensureAuthUser(a.email, a.meta));
}
