import { MailPreloader } from "@/components/mail/preloader";

// While B Mail opens (the shell's own data: mailboxes, counts, signature), the full screen preloader.
export default function MailOpening() {
  return <MailPreloader />;
}
