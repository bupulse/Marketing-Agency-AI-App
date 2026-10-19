import { ConfirmButton } from "@/components/admin/confirm-button";
import { Panel } from "@/components/admin/ui";
import { Badge, Field, Input, Meter, Select } from "@/components/ui";
import type { InboxAdminView } from "@/lib/social/inbox/admin";
import { MAX_MONTHLY_CAP } from "@/lib/social/inbox/settings";
import { setInboxCapAction, setInboxTransportAction, setPrivateReplyAction } from "@/app/admin/(console)/(system)/services/inbox-actions";

const n = (v: number) => v.toLocaleString("en-US");

/** Admin -> Services: how Instagram and Facebook comments and DMs reach the inbox, and the Composio budget. docs/SOCIAL_INBOX.md. */
export function SocialInboxPanel({ view }: { view: InboxAdminView }) {
  const { settings } = view;
  const composio = settings.transport === "composio";
  const ready = composio ? view.composioReady : view.metaReady;
  return (
    <Panel
      title="Instagram and Facebook replies"
      description="Brings clients' Instagram and Facebook comments and DMs into their inbox so automations and their team can answer. BuPulse-Socials checks each switched-on account every few minutes (Composio has no notifications for Meta); Meta direct gets them instantly from Meta's webhooks once Meta has approved BuPulse."
      action={<Badge tone={ready ? "success" : "danger"}>{ready ? "Working" : "Not set up"}</Badge>}
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
        <dt className="text-muted">Route</dt>
        <dd>
          {composio ? "BuPulse-Socials (Composio)" : "Meta direct (BuPulse's own Meta app)"}
          {!ready && (
            <span className="block text-xs text-danger">
              {composio ? "Composio needs COMPOSIO_API_KEY and must be switched on (its card above)." : "Meta direct needs FACEBOOK_APP_SECRET or INSTAGRAM_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN, and Meta switched on."}
            </span>
          )}
        </dd>
        <dt className="text-muted">Accounts switched on</dt>
        <dd>
          {n(view.accounts.composio)} through BuPulse-Socials, {n(view.accounts.direct)} through BuPulse&apos;s own app
          {composio && <span className="block text-xs text-muted">{n(view.pendingChecks)} checks waiting to run</span>}
        </dd>
        <dt className="text-muted">Composio calls this month</dt>
        <dd className="min-w-0">
          <Meter value={view.used} max={Math.max(1, settings.monthlyCap)} label="Composio calls this month" />
          <span className="mt-1 block text-xs text-muted">
            {n(view.used)} of {n(settings.monthlyCap)}. Checks stop at {n(view.pollLimit)}; the last {n(view.replyReserve)} are kept for replies. Posting is counted too but never stopped. Composio&apos;s managed Meta app includes {n(MAX_MONTHLY_CAP)} free calls a month.
          </span>
        </dd>
        <dt className="text-muted">Private replies</dt>
        <dd>
          {settings.privateReplyConfirmed ? "On" : "Off"}
          <span className="block text-xs text-muted">The first DM to someone who only commented. Composio has no tool for it, so it goes through Composio&apos;s proxy and needs Meta permissions Composio&apos;s shared app may not have. Switch it on only after it worked on a test account.</span>
        </dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <ConfirmButton
          action={setInboxTransportAction}
          fields={{}}
          label="Change route"
          title="Change how comments and DMs travel"
          description="One switch for every client. Accounts connected the other way stop answering until their owner reconnects them. Use Meta direct only once Meta has approved BuPulse's app (Advanced Access) and the webhook is set up (docs/SOCIAL_INBOX.md). Written to the audit log."
          confirmLabel="Save"
          pendingLabel="Saving…"
        >
          <Field label="Route" required>
            <Select name="transport" defaultValue={settings.transport} required>
              <option value="composio">BuPulse-Socials (Composio): checks every few minutes</option>
              <option value="meta">Meta direct: webhooks, needs Meta approval</option>
            </Select>
          </Field>
        </ConfirmButton>
        <ConfirmButton
          action={setInboxCapAction}
          fields={{}}
          label="Monthly limit"
          title="Composio calls per month"
          description={`All clients together. Checks stop a little before it and replies at it, so BuPulse stays inside Composio's free calls. At most ${n(MAX_MONTHLY_CAP)}. Written to the audit log.`}
          confirmLabel="Save"
          pendingLabel="Saving…"
        >
          <Field label="Calls per month" required>
            <Input name="monthlyCap" type="number" min={0} max={MAX_MONTHLY_CAP} step={1} defaultValue={settings.monthlyCap} required />
          </Field>
        </ConfirmButton>
        <ConfirmButton
          action={setPrivateReplyAction}
          fields={{ privateReplyConfirmed: settings.privateReplyConfirmed ? "0" : "1" }}
          label={settings.privateReplyConfirmed ? "Switch private replies off" : "Switch private replies on"}
          title={settings.privateReplyConfirmed ? "Switch private replies off?" : "Switch private replies on?"}
          description={
            settings.privateReplyConfirmed
              ? "Automations can no longer send the first DM to a commenter; they reply under the comment instead."
              : "Only if a private reply worked on a test account through the current route. If Meta refuses it, the inbox shows the reason on each message. Written to the audit log."
          }
          confirmLabel={settings.privateReplyConfirmed ? "Switch off" : "Switch on"}
          pendingLabel="Saving…"
        />
      </div>
    </Panel>
  );
}
