// Seeds a realistic week of posts (published / scheduled / draft) for the demo businesses, built from their real projects,
// AI captions and designs. Safety: every SCHEDULED post gets attempts = MAX_ATTEMPTS (5), so the publisher never claims it,
// and the demo connections have no tokens. Nothing here calls Meta.
// Usage: node seed-posts.mjs inzu|urugo|nova   (replaces that business's seeded posts, marked by groupId "demo-...")
import crypto from "node:crypto";
import { pool, q } from "./db.mjs";
import { ACCOUNTS } from "./accounts.mjs";

const slug = process.argv[2];
const [biz] = await q(`select b.id, b."userId" from "Business" b join "User" u on u.id = b."userId" where u.email = $1`, [ACCOUNTS[slug].email]);
const conns = Object.fromEntries((await q(`select id, provider from "Connection" where "businessId" = $1 and kind = 'SOCIAL'`, [biz.id])).map((c) => [c.provider, c.id]));
const id = () => "demo" + crypto.randomBytes(10).toString("hex");
const shortcode = () => crypto.randomBytes(8).toString("base64url").slice(0, 11);

async function project(title) {
  const [p] = await q(`select id from "Project" where "businessId" = $1 and title = $2`, [biz.id, title]);
  const [c] = await q(`select id, caption, hashtags, variants from "GeneratedContent" where "projectId" = $1 and language = 'English' order by "createdAt" desc limit 1`, [p.id]);
  const rows = await q(`select path, "aspectRatio" from "Design" where "projectId" = $1 order by "createdAt"`, [p.id]);
  const designs = rows.filter((d) => d.aspectRatio === "1:1").map((d) => d.path);
  const portrait = rows.find((d) => d.aspectRatio === "4:5")?.path;
  return { id: p.id, content: c, designs, portrait };
}

// Kigali is UTC+2 all year. day: offset from today (Fri 9 Oct 2026); time "HH:MM" local.
function at(day, time) {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(Date.UTC(2026, 9, 9 + day, h - 2, m));
  return d;
}

async function post({ day, time, status, networks = ["instagram", "facebook"], text, hashtags = [], proj, media = [], format = "POST", metrics }) {
  const groupId = `demo-${slug}-${id()}`;
  for (const network of networks) {
    const when = at(day, time);
    const variant = proj?.content?.variants?.find?.((v) => v.network === network);
    const caption = text ?? variant?.caption ?? proj?.content?.caption ?? "";
    const tags = text ? hashtags : (variant?.hashtags ?? proj?.content?.hashtags ?? []);
    const published = status === "PUBLISHED";
    const postId = id();
    // Instagram shows 4:5; use the portrait version of the template design when there is one.
    const netMedia = network === "instagram" && proj?.portrait && media.length && proj.designs.includes(media[0]) && proj.designs.indexOf(media[0]) === 0 ? [proj.portrait] : media;
    const external = published ? `demo_${network}_${crypto.randomBytes(6).toString("hex")}` : null;
    await q(
      `insert into "Post"(id, "businessId", "connectionId", network, "groupId", "projectId", "contentId", status, format, source, text, hashtags, "mediaPaths",
         "scheduledAt", "publishedAt", "externalId", permalink, attempts, "createdAt", "updatedAt")
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'MANUAL',$10,$11,$12,$13,$14,$15,$16,$17, $18, now())`,
      [postId, biz.id, conns[network] ?? null, network, groupId, proj?.id ?? null, text ? null : (proj?.content?.id ?? null), status, format, caption, tags, netMedia,
       status === "DRAFT" ? (day === null ? null : when) : when, published ? when : null, external,
       published ? (network === "instagram" ? `https://www.instagram.com/p/${shortcode()}/` : `https://www.facebook.com/${slug}demo/posts/${crypto.randomInt(1e13, 2e14)}`) : null,
       status === "SCHEDULED" ? 5 : published ? 1 : 0, new Date(when.getTime() - 3 * 864e5)],
    );
    if (published && metrics) {
      const k = network === "instagram" ? 1 : 0.7;
      const reach = Math.round(metrics * k * (0.85 + Math.random() * 0.3));
      await q(`insert into "PostMetrics"(id, "postId", "capturedAt", views, reach, likes, comments, saves, shares) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id(), postId, new Date(when.getTime() + 864e5), Math.round(reach * 1.6), reach, Math.round(reach * 0.07), Math.round(reach * 0.012), Math.round(reach * 0.02), Math.round(reach * 0.01)]);
    }
  }
}

await q(`delete from "Post" where "businessId" = $1 and "groupId" like 'demo-%'`, [biz.id]);

if (slug === "inzu") {
  const dress = await project("Kitenge summer dress");
  const shirt = await project("Men's African print shirt");
  const acc = await project("Head wraps & beaded accessories");
  await post({ day: -3, time: "18:00", status: "PUBLISHED", proj: shirt, media: shirt.designs.slice(0, 1), metrics: 820,
    text: "Friday at the office or a gusaba this weekend? Our new African print shirts are smart, comfortable and made to stand out. Sizes M to XXXL, 18,000 RWF. Visit us in Kimironko or WhatsApp +250 788 412 305 👔",
    hashtags: ["#InzuFashion", "#KigaliFashion", "#AfricanPrint", "#MensFashion", "#Kimironko"] });
  await post({ day: 0, time: "18:00", status: "SCHEDULED", proj: dress, media: dress.designs.slice(-1) });
  await post({ day: 2, time: "11:00", status: "DRAFT", networks: ["instagram"], proj: acc, media: acc.designs.slice(0, 1),
    text: "The secret to a complete look? The details ✨ Matching kitenge head wraps, handmade beaded bracelets and clutch bags, from 5,000 RWF. Come and mix and match in Kimironko!",
    hashtags: ["#InzuFashion", "#HeadWrap", "#KitengeStyle", "#KigaliFashion"] });
}

if (slug === "urugo") {
  const house = await project("3-bedroom house, Kibagabaga");
  const apt = await project("2-bedroom apartment for rent, Kimihurura");
  const villa = await project("4-bedroom villa with pool, Nyarutarama");
  const tags = ["#UrugoHomes", "#KigaliRealEstate", "#HousesForSaleKigali", "#Rwanda"];
  await post({ day: -4, time: "09:00", status: "PUBLISHED", proj: house, media: house.designs.slice(-1), metrics: 2400 });
  await post({ day: -3, time: "18:00", status: "PUBLISHED", proj: apt, media: apt.designs.slice(-1), metrics: 1900 });
  await post({ day: -2, time: "12:30", status: "PUBLISHED", networks: ["facebook"], metrics: 1300,
    text: "Buying land in Kigali? Before you pay a deposit, ask for three things: the land title (with the UPI number), the approved master plan zoning for the plot, and a search at the land office to check there are no disputes or mortgages. Our team helps you check all three, for free. Message us to book a chat.",
    hashtags: [...tags, "#BuyingLand"] });
  await post({ day: -1, time: "09:00", status: "PUBLISHED", proj: villa, media: villa.designs.slice(-1), metrics: 3100 });
  await post({ day: 0, time: "18:00", status: "SCHEDULED", proj: house, media: house.designs.slice(-1),
    text: "Open house this Saturday! 🏡 Come and see our 3-bedroom family home in Kibagabaga: garden, parking for 2 cars, freehold title, 120,000,000 RWF. Saturday 10am to 1pm. Call or WhatsApp +250 788 630 918 to get the address.",
    hashtags: [...tags, "#OpenHouse", "#Kibagabaga"] });
  await post({ day: 1, time: "10:00", status: "SCHEDULED", proj: apt, media: apt.designs.slice(-1),
    text: "Still available from 1 November: a furnished 2-bedroom apartment in Kimihurura with a city-view balcony, 24/7 security and backup power. 600,000 RWF per month, water and internet included. Book a viewing today.",
    hashtags: [...tags, "#ApartmentForRent", "#Kimihurura"] });
  await post({ day: 2, time: "16:00", status: "SCHEDULED", networks: ["instagram"], media: house.designs.slice(0, 1),
    text: "Sold in 3 weeks! 🎉 Congratulations to the Mugenzi family on their new home in Gacuriro. Thinking of selling? We find serious buyers fast. Free valuation: +250 788 630 918",
    hashtags: [...tags, "#Sold", "#Gacuriro"] });
  await post({ day: 3, time: "09:00", status: "SCHEDULED", proj: villa, media: villa.designs.slice(-1) });
  await post({ day: 4, time: "18:00", status: "DRAFT", networks: ["facebook"],
    text: "Diaspora buyers: you can buy a home in Kigali without flying in. We do video viewings, check the paperwork, and work with your notary by power of attorney. Ask us how.",
    hashtags: [...tags, "#Diaspora"] });
}

if (slug === "nova") {
  const a56 = await project("Samsung Galaxy A56");
  const iphone = await project("iPhone 16");
  const acc = await project("Fast chargers & cases");
  const tags = ["#NovaPhonesKigali", "#KigaliPhones", "#Rwanda"];
  // Eight weeks of history for Analytics (the older four weeks are the "period before", with less reach).
  const history = [
    [-57, "18:00", iphone, 900], [-53, "12:00", acc, 600], [-50, "18:00", a56, 1300], [-46, "09:00", null, 500],
    [-43, "18:00", iphone, 1100], [-39, "12:00", acc, 700], [-36, "18:00", a56, 1500], [-32, "09:00", null, 650],
    [-27, "18:00", iphone, 1800], [-25, "12:00", acc, 1100], [-22, "18:00", a56, 2600], [-20, "09:00", null, 900],
    [-18, "18:00", iphone, 2100], [-15, "12:00", acc, 1300], [-13, "18:00", a56, 3200], [-11, "09:00", null, 1000],
    [-8, "18:00", iphone, 2900], [-6, "12:00", acc, 1500], [-4, "18:00", a56, 4100], [-2, "09:00", null, 1700],
  ];
  for (const [day, time, proj, reach] of history) {
    if (proj === null) {
      await post({ day, time, status: "PUBLISHED", metrics: reach, media: acc.designs.slice(0, 1),
        text: "Tip from Nova 💡 Your battery lasts longer if you keep it between 20% and 80%, and use a genuine fast charger. Drop by for a free battery health check, any day this week.",
        hashtags: [...tags, "#PhoneTips"] });
    } else if (proj === acc) {
      await post({ day, time, status: "PUBLISHED", proj, media: proj.designs.slice(0, 1), metrics: reach,
        text: "Is your charger slowing you down? ⚡ Our 25W and 45W fast chargers fill your phone in under an hour, and cases start from 5,000 RWF. Screen protector fitted free while you wait. Kigali Heights, ground floor.",
        hashtags: [...tags, "#FastCharging", "#PhoneAccessories"] });
    } else await post({ day, time, status: "PUBLISHED", proj, media: proj.designs.slice(0, 1), metrics: reach });
  }
  await post({ day: 0, time: "18:00", status: "SCHEDULED", proj: a56, media: a56.designs.slice(-1),
    text: "Weekend deal 🔥 Trade in your old phone and take home the Samsung Galaxy A56 for less. 256GB, 50MP camera, 45W charging, 12-month warranty. 420,000 RWF before trade-in. Kigali Heights, ground floor.",
    hashtags: [...tags, "#GalaxyA56", "#TradeIn"] });
}

console.log(await q(`select status, count(*)::int from "Post" where "businessId" = $1 group by 1`, [biz.id]));
await pool.end();
