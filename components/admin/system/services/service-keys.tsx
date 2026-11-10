import Link from "next/link";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { StatusPill } from "@/components/admin/kit";
import { Field, Input } from "@/components/ui";
import type { EnvState, ServiceView } from "@/lib/admin/services";
import { isSecretName } from "@/lib/admin/service-keys-rules";
import { removeServiceKeyAction, saveServiceKeyAction } from "@/app/admin/(console)/(system)/services/actions";

/** Where a key's value comes from, in words. */
function KeyState({ e, missingIsBad }: { e: EnvState; missingIsBad: boolean }) {
  if (e.source === "saved") {
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusPill tone="good" dot>Saved here</StatusPill>
        <span className="text-[13px] text-muted">
          {isSecretName(e.name) ? `ends ${e.shown}` : e.shown}
          {e.hostSet ? ", used instead of the hosting value" : ""}
        </span>
      </span>
    );
  }
  if (e.source === "host") return <StatusPill tone="good" dot>Set in hosting</StatusPill>;
  return <StatusPill tone={missingIsBad ? "bad" : "muted"} dot>Not set</StatusPill>;
}

function KeyButtons({ s, e }: { s: Pick<ServiceView, "name">; e: EnvState }) {
  const secret = isSecretName(e.name);
  const saved = e.source === "saved";
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      <ConfirmButton
        action={saveServiceKeyAction}
        fields={{ name: e.name }}
        label={saved || e.source === "host" ? "Replace" : secret ? "Add key" : "Set"}
        title={`${saved || e.source === "host" ? "Replace" : "Add"} ${e.name}`}
        description={`For ${s.name}. Saved encrypted and used everywhere within 30 seconds, no redeploy needed.${e.hostSet ? " While it is saved here it is used instead of the value in the hosting environment." : ""}${secret ? " After saving, only its last 4 characters are shown." : ""} The change is written to the audit log.`}
        confirmLabel="Save"
        pendingLabel="Saving…"
        variant={e.set ? "outline" : "primary"}
      >
        <Field label={secret ? "Key" : "Value"} required hint={secret ? "Paste the whole key from the service's dashboard." : undefined}>
          <Input name="value" type={secret ? "password" : "text"} autoComplete="off" spellCheck={false} maxLength={4000} required />
        </Field>
      </ConfirmButton>
      {saved && (
        <ConfirmButton
          action={removeServiceKeyAction}
          fields={{ name: e.name }}
          label="Remove"
          title={`Remove the saved ${e.name}?`}
          description={e.hostSet ? "The value in the hosting environment is used again." : `It is not set anywhere else, so ${s.name} stops working until a key is added again.`}
          confirmLabel="Remove"
          pendingLabel="Removing…"
        />
      )}
    </span>
  );
}

/** One key: its name, where its value comes from, and Add / Replace / Remove when keys are entered here. */
function KeyRow({ s, e, missingIsBad }: { s: Pick<ServiceView, "name" | "keysWhere">; e: EnvState; missingIsBad: boolean }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
      <span className="flex min-w-0 flex-col gap-1">
        <code className="break-all font-mono text-[13px] font-semibold">{e.name}</code>
        <KeyState e={e} missingIsBad={missingIsBad} />
      </span>
      {s.keysWhere === "here" && <KeyButtons s={s} e={e} />}
    </li>
  );
}

/** A service's keys: the ones it needs, where they are entered, and its optional settings folded away. */
export function ServiceKeys({ s }: { s: Pick<ServiceView, "name" | "keysWhere" | "env" | "optionalEnv" | "health"> }) {
  if (s.env.length === 0 && s.optionalEnv.length === 0) return <p className="text-[14px] text-muted">None needed: this service works without a key.</p>;
  const notSetUp = s.health === "not_connected" || s.health === "missing";
  return (
    <div className="flex flex-col gap-3">
      {s.env.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
          {s.env.map((e) => (
            <KeyRow key={e.name} s={s} e={e} missingIsBad={s.health === "missing"} />
          ))}
        </ul>
      )}
      {s.keysWhere === "settings" && (
        <p className="rounded-2xl bg-soft px-4 py-3 text-[13px] text-muted">
          Enter Paddle&apos;s keys in <Link href="/admin/settings/paddle" className="font-semibold underline">Settings, Card payments</Link>: that form checks they match the sandbox or live account.
        </p>
      )}
      {s.keysWhere === "host" && <p className="rounded-2xl bg-soft px-4 py-3 text-[13px] text-muted">Set only in the hosting environment: BuPulse needs these to start, before it can read anything saved here.</p>}
      {notSetUp && s.keysWhere === "here" && (
        <p className="rounded-2xl bg-soft px-4 py-3 text-[13px] text-muted">
          To set it up, add {s.env.filter((e) => !e.set).map((e) => e.name).join(", ")} here (or in the hosting environment), then press Test now.
        </p>
      )}
      {s.optionalEnv.length > 0 && (
        <details className="group rounded-2xl border border-line px-4 py-2">
          <summary className="flex min-h-11 cursor-pointer items-center text-[14px] font-semibold">
            Optional settings ({s.optionalEnv.filter((e) => e.set).length} of {s.optionalEnv.length} set)
          </summary>
          <ul className="flex flex-col divide-y divide-line pb-2">
            {s.optionalEnv.map((e) => (
              <KeyRow key={e.name} s={s} e={e} missingIsBad={false} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
