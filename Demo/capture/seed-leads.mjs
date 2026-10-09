// Older website-chat conversations and leads (the newest Nova leads came from real chats in widget-chat.mjs).
// Rows are marked with visitorId "demo-..." so they can be told apart.
import crypto from "node:crypto";
import { pool, q } from "./db.mjs";
import { ACCOUNTS } from "./accounts.mjs";

const id = () => "demo" + crypto.randomBytes(10).toString("hex");
const ago = (days, hours = 0) => new Date(Date.now() - days * 864e5 - hours * 36e5);

const LEADS = {
  nova: [
    [1, 3, "CONTACTED", "Aimable Habiyaremye", "+250 788 901 442", null, "Tecno Camon 30", "Do you have the Tecno Camon 30 and is there a student discount?", "Do you have the Tecno Camon 30?", "Yes! The Tecno Camon 30 is in stock at 310,000 RWF with a 12-month warranty. Would you like us to keep one for you?"],
    [2, 5, "WON", "Grace Uwimana", "+250 785 330 217", "grace.uwimana@gmail.com", "iPhone 16 screen repair", "Cracked screen, needs same-day repair", "Can you fix an iPhone screen today?", "Yes, we do same-day screen repairs. Bring it to Kigali Heights, ground floor, before 3pm and it will be ready the same evening."],
    [4, 2, "NEW", "Jean Claude Mugabo", "+250 789 114 650", null, "Samsung Galaxy A56", "Wants 3 phones for his office staff", "I need 3 Samsung phones for my staff. Do you give a price for 3?", "We can! For 3 Galaxy A56 phones we can offer a business price. Leave your number and our team will call you with a quote today."],
    [6, 1, "WON", "Clarisse Ingabire", "+250 784 552 908", null, "Fast chargers & cases", "45W charger and a case for Galaxy S24", "Do you have a 45W charger?", "Yes, our 45W fast chargers are 25,000 RWF and we have cases for most phones from 5,000 RWF."],
    [9, 4, "CONTACTED", "Eric Ndayisaba", "+250 787 664 031", null, "Trade-in", "Trade in iPhone 13 for iPhone 16", "How much will you give me for an iPhone 13?", "It depends on its condition. Bring it in and we value it in 10 minutes; the value comes off your new phone."],
    [13, 6, "LOST", "Sandrine Mukeshimana", null, "sandrine.m@yahoo.com", "MoMo instalments", "Asked about instalments for iPhone 16", "Can I pay in instalments?", "Yes, with MoMo instalments over 3 months for phones above 300,000 RWF, with a 30% deposit."],
    [17, 2, "WON", "Patrick Nshimiyimana", "+250 783 220 819", null, "Samsung Galaxy A56", "Bought the A56 in light blue", "Is the A56 available in light blue?", "Yes, light blue is in stock. It's 420,000 RWF with a 12-month warranty."],
    [22, 3, "CONTACTED", "Diane Umutoni", "+250 788 445 120", null, "iPhone 16", "Asked about the 256GB model", "Do you have the iPhone 16 256GB?", "Yes, 1,290,000 RWF, genuine and sealed, with a 12-month warranty."],
    [35, 2, "WON", "Kevin Mugisha", "+250 782 119 340", null, "Infinix Hot 50", "Bought for his daughter", "Do you have Infinix phones?", "Yes, the Infinix Hot 50 is 185,000 RWF with a 12-month warranty."],
    [41, 5, "LOST", "Ange Uwase", null, "ange.uwase@gmail.com", "iPhone 15", "Wanted a used iPhone", "Do you sell used iPhones?", "We only sell new, sealed phones with warranty. The iPhone 16 is 1,150,000 RWF."],
    [48, 1, "WON", "Fabrice Nkusi", "+250 788 667 203", null, "Screen repair", "Galaxy A35 screen replaced", "How much to change a Galaxy A35 screen?", "A genuine Galaxy A35 screen is 65,000 RWF, fitted the same day."],
  ],
  urugo: [
    [0, 4, "NEW", "Sylvie Kamaliza", "+250 788 310 556", "sylvie.k@gmail.com", "3-bedroom house, Kibagabaga", "Wants a viewing on Saturday", "Can I see the Kibagabaga house this weekend?", "Of course. We have an open house on Saturday from 10am to 1pm. Leave your number and Eric will confirm the address."],
    [1, 2, "NEW", "Thomas Becker", null, "t.becker@posteo.de", "2-bedroom apartment for rent, Kimihurura", "Expat moving in November, 12-month lease", "Is the Kimihurura apartment available from November?", "Yes, it is available from 1 November, furnished, at 600,000 RWF per month with water and internet included."],
    [3, 5, "CONTACTED", "Alice Mutesi", "+250 785 920 774", null, "4-bedroom villa with pool, Nyarutarama", "Diaspora buyer in Brussels, video viewing", "I live abroad. Can I view the villa by video?", "Yes, we do video viewings and help with paperwork by power of attorney. Leave your WhatsApp number and we will set it up."],
  ],
  inzu: [
    [0, 6, "NEW", "Josiane Uwera", "+250 786 554 019", null, "Kitenge summer dress", "Size L in terracotta, delivery to Remera", "Do you have the kitenge dress in size L?", "Yes, size L is in stock at 25,000 RWF. We deliver anywhere in Kigali for 2,000 RWF."],
  ],
};

for (const [slug, leads] of Object.entries(LEADS)) {
  const [biz] = await q(`select b.id from "Business" b join "User" u on u.id = b."userId" where u.email = $1`, [ACCOUNTS[slug].email]);
  await q(`delete from "ChatSession" where "businessId" = $1 and "visitorId" like 'demo-%'`, [biz.id]);
  await q(`delete from "Lead" where "businessId" = $1 and notes like '%[demo]%'`, [biz.id]);
  const site = { nova: "novaphones.rw", urugo: "urugohomes.rw", inzu: "inzufashion.rw" }[slug];
  // The page the visitor was on, guessed from what they asked about.
  const pageOf = (interest) => {
    const i = interest.toLowerCase();
    if (slug === "nova") return i.includes("samsung") ? "/phones/samsung-galaxy-a56" : i.includes("iphone") ? "/phones/iphone-16" : i.includes("repair") ? "/repairs" : i.includes("charger") ? "/accessories" : i.includes("trade") ? "/trade-in" : "/phones";
    if (slug === "urugo") return i.includes("kibagabaga") ? "/listings/kibagabaga-3-bedroom-house" : i.includes("kimihurura") ? "/listings/kimihurura-2-bedroom-apartment" : "/listings/nyarutarama-villa";
    return "/shop/kitenge-summer-dress";
  };
  for (const [d, h, status, name, phone, email, interest, message, ask, answer] of leads) {
    const at = ago(d, h);
    const sid = id();
    await q(`insert into "ChatSession"(id, "businessId", "visitorId", origin, "pageUrl", language, "messageCount", "createdAt", "lastMessageAt") values ($1,$2,$3,$4,$5,'en',2,$6,$7)`,
      [sid, biz.id, `demo-${crypto.randomBytes(6).toString("hex")}`, site, `https://${site}${pageOf(interest)}`, at, new Date(at.getTime() + 90e3)]);
    await q(`insert into "ChatMessage"(id, "sessionId", role, content, "createdAt") values ($1,$2,'visitor',$3,$4), ($5,$2,'assistant',$6,$7)`,
      [id(), sid, ask, at, id(), answer, new Date(at.getTime() + 4e3)]);
    await q(`insert into "Lead"(id, "businessId", name, email, phone, interest, message, source, status, notes, "sessionId", "pageUrl", "createdAt", "updatedAt")
             values ($1,$2,$3,$4,$5,$6,$7,'website_chat',$8,$9,$10,$11,$12,$12)`,
      [id(), biz.id, name, email, phone, interest, message, status, status === "WON" ? "Sold in store. [demo]" : status === "CONTACTED" ? "Called back, follow up this week. [demo]" : "[demo]", sid, `https://${site}${pageOf(interest)}`, new Date(at.getTime() + 90e3)]);
  }
  // A few more chats that did not leave details, for the analytics chat count.
  if (slug === "nova") for (let i = 0; i < 24; i++) {
    const at = ago(1 + i * 2.4, i % 5);
    const sid = id();
    await q(`insert into "ChatSession"(id, "businessId", "visitorId", origin, "pageUrl", language, "messageCount", "createdAt", "lastMessageAt") values ($1,$2,$3,$4,$5,'en',2,$6,$6)`,
      [sid, biz.id, `demo-${crypto.randomBytes(6).toString("hex")}`, site, `https://${site}/`, at]);
    await q(`insert into "ChatMessage"(id, "sessionId", role, content, "createdAt") values ($1,$2,'visitor','What time do you close on Sunday?',$3), ($4,$2,'assistant','On Sunday we are open from 10am to 6pm, at Kigali Heights, ground floor.',$3)`, [id(), sid, at, id()]);
  }
  console.log(slug, (await q(`select status, count(*)::int from "Lead" where "businessId" = $1 group by 1`, [biz.id])));
}
await pool.end();
