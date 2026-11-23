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
