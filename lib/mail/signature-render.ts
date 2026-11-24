// The email signature as HTML (tables and inline styles, for every mail app) and as plain text (docs/MAIL_CRM.md
// "Signatures", "Phones in signatures"). Company parts come from MailSettings and cannot be changed by staff; the
// person's own lines come from MailMember. Pure, so tests and the composer preview share it.

import { escapeHtml } from "./html";

export type SignatureCompany = {
  website: string;
  address: string;
  companyPhone: string | null; // already formatted ("+250 788 000 000")
  linkedinUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  ctaText: string;
  ctaUrl: string;
  logoUrl: string; // absolute URL of the logo image
};

export type SignaturePerson = { name: string; title: string | null; email: string; mobile: string | null; extra: string | null };

const href = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

export function signatureText(c: SignatureCompany, p: SignaturePerson): string {
  const lines = [
    p.name,
    `${p.title ? `${p.title}, ` : ""}BuPulse`,
    `${c.website} | ${p.email}`,
    [c.companyPhone ? `Office ${c.companyPhone}` : "", p.mobile ? `Mobile ${p.mobile}` : ""].filter(Boolean).join(" | "),
    c.address,
    p.extra ?? "",
    `${c.ctaText}: ${c.ctaUrl}`,
  ];
  return lines.filter((l) => l.trim()).join("\n");
}

/** The Classic look (the owner's reference): logo, accent bar, name, title in blue, contacts, social links, quote button. */
export function signatureHtml(c: SignatureCompany, p: SignaturePerson): string {
  const e = escapeHtml;
  const phones = [c.companyPhone ? `Office ${e(c.companyPhone)}` : "", p.mobile ? `Mobile ${e(p.mobile)}` : ""].filter(Boolean).join(' <span style="color:#c7c7cc">|</span> ');
  const socials = [
    c.linkedinUrl ? `<a href="${e(href(c.linkedinUrl))}" style="color:#0a66c2;text-decoration:none;font-weight:600">LinkedIn</a>` : "",
    c.instagramUrl ? `<a href="${e(href(c.instagramUrl))}" style="color:#b4236b;text-decoration:none;font-weight:600">Instagram</a>` : "",
    c.facebookUrl ? `<a href="${e(href(c.facebookUrl))}" style="color:#1660d6;text-decoration:none;font-weight:600">Facebook</a>` : "",
  ].filter(Boolean).join("&nbsp;&nbsp;&nbsp;");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;border-collapse:collapse"><tr>
<td style="vertical-align:middle;padding-right:22px"><img src="${e(c.logoUrl)}" alt="BuPulse" width="140" style="display:block;width:140px;height:auto;border:0"></td>
<td style="width:3px;background:#2f6bff;background-image:linear-gradient(180deg,#2f6bff,#7b5cff);border-radius:2px">&nbsp;</td>
<td style="vertical-align:top;padding-left:22px;font-size:13px;line-height:1.55;color:#0f172a">
<div style="font-size:16px;font-weight:700">${e(p.name)}</div>
<div style="font-size:14px;font-weight:700;color:#1f5ae6">${p.title ? `${e(p.title)}, ` : ""}BuPulse</div>
<div style="margin-top:4px"><a href="${e(href(c.website))}" style="color:#0f172a;font-weight:700;text-decoration:none">${e(c.website)}</a> <span style="color:#c7c7cc">|</span> ${e(p.email)}</div>
${phones ? `<div>${phones}</div>` : ""}
<div style="color:#64748b">${e(c.address)}</div>
${p.extra ? `<div style="color:#64748b">${e(p.extra)}</div>` : ""}
${socials ? `<div style="margin-top:4px">${socials}</div>` : ""}
<div style="margin-top:10px"><a href="${e(href(c.ctaUrl))}" style="display:inline-block;padding:10px 18px;border-radius:9px;background:#1f5ae6;color:#ffffff;font-weight:700;text-decoration:none">${e(c.ctaText)}</a></div>
</td></tr></table>`;
}

/**
 * The 5 signature looks (docs/MAIL_CRM.md "Signatures": 5 templates). The console picks the default for new users
 * (MailSettings.defaultTemplate) and each person picks their own (MailMember.prefs.signatureTemplate).
 */
export const SIGNATURE_LOOKS = [
  { id: "classic", name: "Classic" },
  { id: "compact", name: "Compact" },
  { id: "card", name: "Card" },
  { id: "simple", name: "Simple" },
  { id: "banner", name: "Banner" },
] as const;

export type SignatureLook = (typeof SIGNATURE_LOOKS)[number]["id"];
export const isSignatureLook = (v: unknown): v is SignatureLook => SIGNATURE_LOOKS.some((l) => l.id === v);

/** A sibling image of the logo (".../brand/logo.png" -> ".../brand/mark.png"), else the logo itself. */
const LOGO_FILE = /\/logo\.png(\?.*)?$/;
const brandAsset = (logoUrl: string, file: string) => (LOGO_FILE.test(logoUrl) ? logoUrl.replace(LOGO_FILE, `/${file}`) : logoUrl);

const FONT = "font-family:Arial,Helvetica,sans-serif";
const SEP = '<span style="color:#c7c7cc">|</span>';
const titleLine = (p: SignaturePerson) => `${p.title ? `${escapeHtml(p.title)}, ` : ""}BuPulse`;

function phonesLine(c: SignatureCompany, p: SignaturePerson, joiner: string): string {
  const e = escapeHtml;
  return [c.companyPhone ? `Office ${e(c.companyPhone)}` : "", p.mobile ? `Mobile ${e(p.mobile)}` : ""].filter(Boolean).join(joiner);
}

/** Compact: the small B mark, one line for the name and title, one line for phones, website and social links. */
function compactHtml(c: SignatureCompany, p: SignaturePerson): string {
  const e = escapeHtml;
  const socials = [
    c.linkedinUrl ? `<a href="${e(href(c.linkedinUrl))}" style="color:#0a66c2;text-decoration:none">in</a>` : "",
    c.instagramUrl ? `<a href="${e(href(c.instagramUrl))}" style="color:#b4236b;text-decoration:none">ig</a>` : "",
    c.facebookUrl ? `<a href="${e(href(c.facebookUrl))}" style="color:#1660d6;text-decoration:none">fb</a>` : "",
  ].filter(Boolean).join(" ");
  const bits = [phonesLine(c, p, " | "), `<a href="${e(href(c.website))}" style="color:#475569;text-decoration:none">${e(c.website)}</a>`, socials].filter(Boolean).join(" &middot; ");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${FONT};border-collapse:collapse"><tr>
<td style="vertical-align:middle;padding-right:12px"><img src="${e(brandAsset(c.logoUrl, "mark.png"))}" alt="BuPulse" width="40" height="40" style="display:block;width:40px;height:40px;border:0"></td>
<td style="vertical-align:middle;font-size:13px;line-height:1.5;color:#475569">
<div><strong style="color:#0f172a">${e(p.name)}</strong> <span style="color:#1f5ae6;font-weight:600">&middot; ${titleLine(p)}</span></div>
<div>${bits}</div>
${p.extra ? `<div style="color:#64748b">${e(p.extra)}</div>` : ""}
</td></tr></table>`;
}

/** Card: the logo on top, name, title, one contact line and an outlined quote button. */
function cardHtml(c: SignatureCompany, p: SignaturePerson): string {
  const e = escapeHtml;
  const contact = [phonesLine(c, p, " | "), e(p.email), e(c.address)].filter(Boolean).join(" &middot; ");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${FONT};border-collapse:collapse"><tr><td style="font-size:13px;line-height:1.55;color:#475569">
<img src="${e(c.logoUrl)}" alt="BuPulse" width="120" style="display:block;width:120px;height:auto;border:0">
<div style="margin-top:8px;font-size:16px;font-weight:700;color:#0f172a">${e(p.name)}</div>
<div style="font-weight:600;color:#1f5ae6">${titleLine(p)}</div>
<div>${contact}</div>
${p.extra ? `<div style="color:#64748b">${e(p.extra)}</div>` : ""}
<div style="margin-top:10px"><a href="${e(href(c.ctaUrl))}" style="display:inline-block;padding:8px 14px;border-radius:999px;border:1.5px solid #1f5ae6;color:#1f5ae6;font-weight:700;text-decoration:none">${e(c.ctaText)}</a></div>
</td></tr></table>`;
}

/** Simple: three plain lines, no logo or colours. */
function simpleHtml(c: SignatureCompany, p: SignaturePerson): string {
  const e = escapeHtml;
  const third = [phonesLine(c, p, " | "), e(c.website)].filter(Boolean).join(" &middot; ");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${FONT};border-collapse:collapse"><tr><td style="font-size:13px;line-height:1.55;color:#334155">
<div style="font-weight:700;color:#0f172a">${e(p.name)}</div>
<div>${titleLine(p)}</div>
<div>${third}</div>
${p.extra ? `<div>${e(p.extra)}</div>` : ""}
</td></tr></table>`;
}

/** Banner: name and title, then a blue-to-violet strip with the white logo, a short line and the quote button. */
function bannerHtml(c: SignatureCompany, p: SignaturePerson): string {
  const e = escapeHtml;
  const sub = [titleLine(p), phonesLine(c, p, ` ${SEP} `)].filter(Boolean).join(" &middot; ");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${FONT};border-collapse:collapse;max-width:480px"><tr><td style="font-size:13px;line-height:1.5;color:#475569;padding-bottom:10px">
<div style="font-size:16px;font-weight:700;color:#0f172a">${e(p.name)}</div>
<div>${sub}</div>
<div><a href="${e(href(c.website))}" style="color:#475569;text-decoration:none">${e(c.website)}</a> ${SEP} ${e(p.email)}</div>
${p.extra ? `<div style="color:#64748b">${e(p.extra)}</div>` : ""}
</td></tr><tr><td style="border-radius:12px;background:#2f6bff;background-image:linear-gradient(120deg,#2f6bff,#6a4df0);padding:12px 16px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%"><tr>
<td style="vertical-align:middle;padding-right:14px"><img src="${e(brandAsset(c.logoUrl, "logo-white.png"))}" alt="BuPulse" width="96" style="display:block;width:96px;height:auto;border:0"></td>
<td style="vertical-align:middle;font-size:13px;color:#ffffff">Posts, videos and leads for your business</td>
<td style="vertical-align:middle;text-align:right;padding-left:12px"><a href="${e(href(c.ctaUrl))}" style="display:inline-block;padding:8px 12px;border-radius:8px;background:#ffffff;color:#1f5ae6;font-size:12.5px;font-weight:700;text-decoration:none;white-space:nowrap">${e(c.ctaText)}</a></td>
</tr></table>
</td></tr></table>`;
}

/** The signature in a chosen look; anything unknown (or nothing) is the Classic look, exactly signatureHtml. */
export function signatureHtmlFor(look: string | null | undefined, c: SignatureCompany, p: SignaturePerson): string {
  switch (look) {
    case "compact": return compactHtml(c, p);
    case "card": return cardHtml(c, p);
    case "simple": return simpleHtml(c, p);
    case "banner": return bannerHtml(c, p);
    default: return signatureHtml(c, p);
  }
}
