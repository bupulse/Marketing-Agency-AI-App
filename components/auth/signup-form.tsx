"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import {
  emailStepSchema,
  fieldErrors,
  organisationSchema,
  passwordStepSchema,
  type FieldErrors,
} from "@/lib/auth/schemas";
import { signInWithGoogle } from "@/app/login/actions";
import { checkEmail, signUp, type SignUpState } from "@/app/signup/actions";
import { cn } from "@/lib/cn";
import type { IndustryOption } from "@/lib/industries/shared";
import { VisitSessionField } from "./visit-session-field";
import { ConfirmEmail } from "./confirm-email";
import { GoogleIcon } from "./google-icon";
import { OrganisationFields, TermsField } from "./organisation-fields";
import { PasswordChecks } from "./password-checks";
import { PasswordInput } from "./password-input";

type Step = 1 | 2 | 3;

const STEPS = [
  { n: 1, label: "Email" },
  { n: 2, label: "Organisation" },
  { n: 3, label: "Password" },
] as const;

const STEP_FIELDS: Record<Step, string[]> = {
  1: ["email"],
  2: ["organisationName", "ceoName", "industry", "industryOther", "industryDescription", "country", "phone", "website"],
  3: ["password", "confirmPassword", "terms"],
};

const TITLES: Record<Step, { title: string; sub: string }> = {
  1: { title: "Create your account", sub: "Then choose a plan and book a free demo. No credit card needed." },
  2: { title: "About your organisation", sub: "This helps us write in your brand voice from day one." },
  3: { title: "Secure your account", sub: "Choose a password to finish." },
};

const empty = {
  email: "",
  organisationName: "",
  ceoName: "",
  industry: "",
  industryOther: "",
  industryDescription: "",
  country: "",
  phone: "",
  website: "",
  password: "",
  confirmPassword: "",
  terms: false,
};
type Values = typeof empty;

function Progress({ step }: { step: Step }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] font-medium text-muted">
        <span aria-hidden>Step {step} of 3</span>
        <span className="sr-only">
          Step {step} of 3: {STEPS[step - 1].label}
        </span>
      </p>
      <ol aria-label="Sign-up progress" className="flex gap-2">
        {STEPS.map((s) => (
          <li
            key={s.n}
            aria-current={s.n === step ? "step" : undefined}
            className="flex flex-1 flex-col gap-1"
          >
            <span className={cn("h-1.5 rounded-full transition-colors", s.n <= step ? "bg-brand-gradient" : "bg-line")} />
            <span className={cn("text-xs", s.n === step ? "font-semibold text-text" : "text-muted")}>
              {s.n}. {s.label}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function SignupForm({ next = "/dashboard", industries }: { next?: string; industries: IndustryOption[] }) {
  const [step, setStep] = useState<Step>(1);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const router = useRouter();
  const [values, setValues] = useState<Values>(empty);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [state, formAction, pending] = useActionState<SignUpState, FormData>(signUp, { status: "idle" });
  const [dismissed, setDismissed] = useState<SignUpState | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  const [handled, setHandled] = useState<SignUpState | null>(null);

  // Move focus to the new step's heading so screen readers announce the change.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  // Server-side validation failures send the person back to the step that owns the field.
  // Adjusting state while rendering (instead of in an effect) avoids a cascading render.
  if (state.status === "error" && state.fieldErrors && handled !== state) {
    setHandled(state);
    setErrors(state.fieldErrors);
    const first = ([1, 2, 3] as Step[]).find((s) => STEP_FIELDS[s].some((f) => state.fieldErrors![f]));
    if (first) setStep(first);
  }

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: "" }));
  }

  function focusFirstError(found: FieldErrors) {
    const name = STEP_FIELDS[step].find((f) => found[f]);
    if (!name) return;
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(`[name="${name}"]`)?.focus());
  }

  function validate(target: Step): boolean {
    const result =
      target === 1
        ? emailStepSchema.safeParse(values)
        : target === 2
          ? organisationSchema.safeParse(values)
          : passwordStepSchema.safeParse(values);
    const found = result.success ? {} : fieldErrors(result.error);
    setErrors(found);
    if (!result.success) focusFirstError(found);
    return result.success;
  }

  async function goNext() {
    if (!validate(step)) return;
    if (step === 1) {
      setCheckingEmail(true);
      const { registered, signInUrl } = await checkEmail(values.email).catch(() => ({ registered: false, signInUrl: undefined }));
      setCheckingEmail(false);
      if (registered) {
        router.push(`${signInUrl ?? `/login?notice=exists&email=${encodeURIComponent(values.email.trim())}`}${next !== "/dashboard" ? `&next=${encodeURIComponent(next)}` : ""}`);
        return;
      }
    }
    setStep((step + 1) as Step);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (step < 3) {
      e.preventDefault();
      if (!checkingEmail) void goNext();
      return;
    }
    if (!validate(3)) e.preventDefault();
  }

  function submitAction() {
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) fd.set(k, String(v));
    fd.set("next", next);
    formAction(fd);
  }

  if (state.status === "sent" && dismissed !== state) {
    return (
      <ConfirmEmail
        email={state.email}
        next={next}
        onChangeEmail={() => {
          setDismissed(state);
          setValues((v) => ({ ...v, password: "", confirmPassword: "", terms: false }));
          setStep(1);
        }}
      />
    );
  }

  const { title, sub } = TITLES[step];

  return (
    <div className="flex flex-col gap-6">
      <Progress step={step} />
      <div className="flex flex-col gap-1.5">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-[-0.03em] outline-none focus-visible:outline-none">
          {title}
        </h1>
        <p className="text-[15px] text-muted">{sub}</p>
      </div>

      {step === 1 && (
        <>
          <form action={signInWithGoogle}>
            <input type="hidden" name="next" value={next} />
            <VisitSessionField />
            <Button type="submit" variant="white" size="lg" className="w-full" leading={<GoogleIcon />}>
              Continue with Google
            </Button>
          </form>
          <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-muted" aria-hidden>
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <form ref={formRef} noValidate onSubmit={onSubmit} action={submitAction} className="flex flex-col gap-4">
        <VisitSessionField />
        {state.status === "error" && state.message && (
          <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
            {state.message}
          </p>
        )}

        {step === 1 && (
          <Field label="Email" required error={errors.email}>
            <Input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@yourbusiness.com"
              value={values.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
        )}

        {step === 2 && <OrganisationFields values={values} errors={errors} onChange={set} industries={industries} />}

        {step === 3 && (
          <>
            <Field label="Password" required error={errors.password}>
              <PasswordInput
                name="password"
                autoComplete="new-password"
                value={values.password}
                onChange={(e) => set("password", e.target.value)}
              />
            </Field>
            <PasswordChecks value={values.password} />
            <Field label="Confirm password" required error={errors.confirmPassword}>
              <PasswordInput
                name="confirmPassword"
                autoComplete="new-password"
                value={values.confirmPassword}
                onChange={(e) => set("confirmPassword", e.target.value)}
              />
            </Field>
            <TermsField checked={values.terms} error={errors.terms} onChange={(v) => set("terms", v)} />
          </>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          {step > 1 && (
            <Button
              type="button"
              variant="outline"
              className="sm:flex-1"
              leading={<ArrowLeft aria-hidden className="size-4" />}
              onClick={() => {
                setErrors({});
                setStep((step - 1) as Step);
              }}
            >
              Back
            </Button>
          )}
          <Button
            type="submit"
            disabled={pending || checkingEmail}
            className={step > 1 ? "sm:flex-1" : "w-full"}
            trailing={step < 3 ? <ArrowRight aria-hidden className="size-4" /> : undefined}
          >
            {checkingEmail ? "Checking…" : step < 3 ? "Continue" : pending ? "Creating account…" : "Create account"}
          </Button>
        </div>
      </form>

      <p className="text-sm text-muted">
        Already have an account?{" "}
        <Link href={next !== "/dashboard" ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="inline-flex min-h-11 items-center font-semibold text-pulse-blue underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
