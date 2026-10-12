"use client";

import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { createKey, revokeKey } from "@/app/dashboard/connectors/api/actions";
import { Badge, Button, Dialog, GlassCard, Input, useToast } from "@/components/ui";
import { SecretBox } from "./secret-box";
import { When } from "./when";

// Kept in step with lib/api/keys.ts (that file is server-only, so the labels are repeated here).
const SCOPES = [
  { id: "projects:read", label: "Read projects" },
  { id: "content:read", label: "Read generated content" },
  { id: "posts:read", label: "Read posts" },
  { id: "posts:write", label: "Create draft posts" },
  { id: "leads:read", label: "Read leads" },
  { id: "leads:write", label: "Change lead status and notes" },
];

export type KeyView = { id: string; name: string; prefix: string; scopes: string[]; lastUsedAt: string | null; revokedAt: string | null; createdAt: string };

/** `readOnly`: the plan no longer has API access. The keys stay to look at and revoke; creating one is not offered. */
export function ApiKeysManager({ keys, max, readOnly = false }: { keys: KeyView[]; max: number; readOnly?: boolean }) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["leads:read"]);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<KeyView | null>(null);
  const active = keys.filter((k) => !k.revokedAt);

  function submit() {
    setError(null);
    start(async () => {
      const result = await createKey({ name, scopes });
      if (!result.ok) return setError(result.error);
      setAdding(false);
      setName("");
      setScopes(["leads:read"]);
      setCreated(result.key);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {created && <SecretBox title="Your API key. Copy it now: it is not shown again." value={created} onDone={() => setCreated(null)} />}

      <section aria-labelledby="keys" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <h2 id="keys" className="text-lg font-semibold">
            Your keys
          </h2>
          {!readOnly && (
            <Button size="sm" onClick={() => { setError(null); setAdding(true); }} disabled={active.length >= max} leading={<Plus aria-hidden className="size-4" />}>
              Create key
            </Button>
          )}
        </div>
        {keys.length === 0 ? (
          <GlassCard className="flex flex-col gap-2 rounded-card p-5">
            <p className="font-semibold">No keys yet</p>
            <p className="text-[14px] text-muted">Create a key, choose what it may do, and send it as <code>Authorization: Bearer bp_live_…</code>. Examples are in docs/API.md.</p>
          </GlassCard>
        ) : (
          <GlassCard padding="none" className="rounded-card">
            <ul className="divide-y divide-line">
              {keys.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4" data-key={k.id} data-revoked={k.revokedAt ? "true" : "false"}>
                  <div className="min-w-0 flex-1 basis-60">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{k.name}</p>
                      <code className="text-[13px] text-muted">{k.prefix}…</code>
                      {k.revokedAt && <Badge tone="danger">Revoked</Badge>}
                    </div>
                    <p className="mt-1 text-[13px] text-muted">
                      {k.scopes.join(", ")}
                    </p>
                    <p className="text-[13px] text-muted">
                      Created <When iso={k.createdAt} /> · {k.lastUsedAt ? <>last used <When iso={k.lastUsedAt} /></> : "never used"}
                    </p>
                  </div>
                  {!k.revokedAt && (
                    <Button variant="outline" size="sm" onClick={() => setRevoking(k)} aria-label={`Revoke key ${k.name}`}>
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </GlassCard>
        )}
        <p className="px-1 text-[13px] text-muted">Each key may make 60 requests a minute. Keep keys secret: anyone who has one can do what it allows.</p>
      </section>

      {adding && (
        <Dialog open onOpenChange={(o) => !o && setAdding(false)} title="Create an API key" description="Give it only the permissions it needs.">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
              Name
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Reporting script" maxLength={60} required invalid={Boolean(error)} />
            </label>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[14px] font-semibold">Permissions</legend>
              {SCOPES.map((s) => (
                <label key={s.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border border-line px-3 py-2">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-[var(--color-pulse-blue)]"
                    checked={scopes.includes(s.id)}
                    onChange={(e) => setScopes(e.target.checked ? [...scopes, s.id] : scopes.filter((x) => x !== s.id))}
                  />
                  <span className="min-w-0 text-[15px]">
                    {s.label} <code className="text-[12px] text-muted">{s.id}</code>
                  </span>
                </label>
              ))}
            </fieldset>
            {error && (
              <p role="alert" className="text-[13px] font-medium text-danger">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              <Button type="button" variant="outline" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Creating..." : "Create key"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
      {revoking && (
        <Dialog open onOpenChange={(o) => !o && setRevoking(null)} title={`Revoke “${revoking.name}”?`} description="Anything using this key stops working right away. This cannot be undone.">
          <div className="mt-2 flex flex-wrap justify-end gap-3">
            <Button variant="outline" size="sm" onClick={() => setRevoking(null)}>
              Keep it
            </Button>
            <Button
              size="sm"
              disabled={pending}
              className="!bg-danger !bg-none !text-white !shadow-none"
              onClick={() =>
                start(async () => {
                  const r = await revokeKey(revoking.id);
                  setRevoking(null);
                  toast(r.ok ? "Key revoked." : r.error, r.ok ? "success" : "error");
                })
              }
            >
              Revoke
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
