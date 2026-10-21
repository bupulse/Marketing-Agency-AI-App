"use client";

import { BadgeCheck, CircleCheck } from "lucide-react";
import { useActionState } from "react";
import { Badge, Button, Field, GlassCard, Input, Textarea } from "@/components/ui";
import { saveProfileAction, type ProfileState } from "@/app/creator/(portal)/actions";
import { CREATOR_NETWORKS, NETWORK_LABEL, type CreatorNetwork } from "@/lib/creators/describe";
import { BIO_MAX, LOCATION_MAX } from "@/lib/creators/profile-form";

export type ProfileFormValues = {
  name: string;
  phone: string;
  location: string;
  bio: string;
  handles: Partial<Record<CreatorNetwork, { handle: string; followers: string }>>;
  samples: string[];
  discoverable: boolean;
};

const initial: ProfileState = { status: "idle" };

/**
 * The creator's profile (/creator/profile): filled once, it fills every one-tap application. `verified`: the networks
 * with a connected account (shown as verified next to the typed name). `next`: the campaign page to go back to.
 */
export function ProfileForm({ profile, verified, next }: { profile: ProfileFormValues; verified: Partial<Record<CreatorNetwork, string>>; next: string | null }) {
  const [state, action, pending] = useActionState(saveProfileAction, initial);
  const errors = state.errors ?? {};
  // After an error the fields keep what was typed; otherwise they show the saved profile.
  const v = state.values;
  const val = (name: string, saved: string) => (v ? (v[name] ?? "") : saved);

  return (
    <GlassCard strong padding="lg" className="p-5 sm:p-8">
      <form key={JSON.stringify(v ?? {})} action={action} noValidate className="flex flex-col gap-5">
        {next && <input type="hidden" name="next" value={next} />}
        <Field label="Your name" required error={errors.name}>
          <Input name="name" autoComplete="name" defaultValue={val("name", profile.name)} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="WhatsApp number" required hint="Companies you apply to may message you here." error={errors.phone}>
            <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+250 791 954 277" defaultValue={val("phone", profile.phone)} />
          </Field>
          <Field label="Where you are" hint="Your district or city, e.g. Kigali, Gasabo." error={errors.location}>
            <Input name="location" maxLength={LOCATION_MAX} defaultValue={val("location", profile.location)} />
          </Field>
        </div>
        <Field label="About you" hint={`A few lines on what you post and who follows you. Up to ${BIO_MAX} characters.`} error={errors.bio}>
          <Textarea name="bio" rows={3} maxLength={BIO_MAX} defaultValue={val("bio", profile.bio)} />
        </Field>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-[15px] font-semibold">Your accounts</legend>
          <p className="-mt-2 text-[13px] text-muted">The name you use on each network you post on, and how many followers you have. A campaign needs one of its platforms here.</p>
          {CREATOR_NETWORKS.map((n) => (
            <div key={n} className="flex flex-col gap-2">
              <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                <Field label={`${NETWORK_LABEL[n]} name`} error={errors[`handle_${n}`]}>
                  <Input name={`handle_${n}`} placeholder="@yourname" autoCapitalize="none" autoCorrect="off" defaultValue={val(`handle_${n}`, profile.handles[n]?.handle ?? "")} />
                </Field>
                <Field label="Followers" error={errors[`followers_${n}`]}>
                  <Input name={`followers_${n}`} inputMode="numeric" placeholder="12k" defaultValue={val(`followers_${n}`, profile.handles[n]?.followers ?? "")} />
                </Field>
              </div>
              {verified[n] && (
                <Badge tone="success" className="self-start">
                  <BadgeCheck aria-hidden className="size-3.5" /> Verified: {verified[n]} is connected
                </Badge>
              )}
            </div>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-[15px] font-semibold">Your best posts</legend>
          <p className="-mt-1 text-[13px] text-muted">Up to three links to posts you are proud of.</p>
          {[1, 2, 3].map((i) => (
            <Field key={i} label={`Link ${i}`} error={errors[`sample_${i}`]}>
              <Input name={`sample_${i}`} type="url" inputMode="url" placeholder="https://" defaultValue={val(`sample_${i}`, profile.samples[i - 1] ?? "")} />
            </Field>
          ))}
        </fieldset>

        <label className="flex cursor-pointer items-start gap-3 rounded-field bg-soft p-4">
          <input type="checkbox" name="discoverable" defaultChecked={v ? v.discoverable === "on" : profile.discoverable} className="mt-0.5 size-5 shrink-0 accent-[var(--color-pulse-violet,#6d4aff)]" />
          <span className="flex flex-col gap-0.5">
            <span className="text-[15px] font-semibold">Let companies find me</span>
            <span className="text-[13px] text-muted">Companies on BuPulse can see your profile and invite you to their campaigns. They see your WhatsApp and email only after you apply to or join one of theirs.</span>
          </span>
        </label>

        {state.error && (
          <p role="alert" className="rounded-field bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
            {state.error}
          </p>
        )}
        {state.status === "saved" && (
          <p role="status" className="flex items-center gap-2 rounded-field bg-success-bg px-4 py-3 text-sm font-medium text-success">
            <CircleCheck aria-hidden className="size-4" /> Saved.
          </p>
        )}
        <Button type="submit" disabled={pending} className="w-full sm:w-auto sm:self-start">
          {pending ? "Saving…" : next ? "Save and go back to the campaign" : "Save"}
        </Button>
      </form>
    </GlassCard>
  );
}
