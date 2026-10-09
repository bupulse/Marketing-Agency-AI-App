// The voiceover (English) and burned-in subtitles (Kinyarwanda) for every video, scene by scene.
// Social media versions play the scenes without `demoOnly`; in-person versions play all of them.
// Each line is [English spoken, Kinyarwanda subtitle]. Numbers are spelled out for the voice; screens show digits.
// The Kinyarwanda was written by AI: have a native speaker check it before release.

export type Line = [en: string, rw: string];

export type Scene = {
  id: string;
  /** Key of the visual in src/visuals/index.tsx. */
  visual: string;
  lines: Line[];
  demoOnly?: boolean;
  /** Extra seconds held after the voice ends (default 0.6). */
  hold?: number;
};

export type Video = { id: string; title: string; scenes: Scene[] };

const END: Scene = {
  id: "end",
  visual: "EndCard",
  lines: [["Book your free demo on WhatsApp, or visit bupulse dot com.", "Saba kwerekwa uko bikora ku buntu kuri WhatsApp, cyangwa usure bupulse.com."]],
  hold: 2.5,
};

export const VIDEOS: Video[] = [
  {
    id: "01-intro",
    title: "Intro",
    scenes: [
      {
        id: "hook",
        visual: "Hook",
        lines: [
          ["Posting every day takes hours.", "Gushyira amatangazo ku mbuga buri munsi bitwara amasaha menshi."],
          ["What if your marketing could run itself?", "Byagenda bite kwamamaza kwawe kwikoze ubwako?"],
          ["Meet BuPulse, the AI marketing assistant for small businesses.", "Menya BuPulse, umufasha wa AI mu kwamamaza ku bucuruzi buto."],
        ],
      },
      {
        id: "problem",
        visual: "Problem",
        demoOnly: true,
        lines: [
          ["Most shops in Kigali sell on Instagram, Facebook and WhatsApp. But good posts take time: writing, designing, and choosing the right moment.", "Amaduka menshi i Kigali acururiza kuri Instagram, Facebook na WhatsApp. Ariko amatangazo meza atwara igihe: kwandika, gukora amafoto, no guhitamo igihe gikwiye."],
          ["BuPulse does that work for you, in English, Kinyarwanda, French or Swahili.", "BuPulse igukorera ako kazi, mu Cyongereza, Ikinyarwanda, Igifaransa cyangwa Igiswahili."],
        ],
      },
      {
        id: "landing",
        visual: "Landing",
        lines: [
          ["Open bupulse dot com.", "Fungura bupulse.com."],
          ["BuPulse writes your captions, designs your posts, plans your calendar, and brings you new customers.", "BuPulse ikwandikira amagambo, igakora amafoto y'amatangazo, igategura gahunda yawe, kandi ikakuzanira abakiriya bashya."],
        ],
      },
      {
        id: "features",
        visual: "LandingFeatures",
        demoOnly: true,
        lines: [["Scroll down to see everything it does: content, designs, one calendar for all your pages, a chat for your website, and Autopilot.", "Manuka urebe ibyo ikora byose: inyandiko, amafoto, gahunda imwe y'imbuga zawe zose, ikiganiro ku rubuga rwawe, na Autopilot."]],
      },
      {
        id: "pricing",
        visual: "PricingRW",
        lines: [
          ["Prices are in Rwandan francs.", "Ibiciro biri mu mafaranga y'u Rwanda."],
          ["Starter is fifteen thousand francs a month. Business is thirty-five thousand.", "Starter ni amafaranga ibihumbi cumi na bitanu ku kwezi. Business ni ibihumbi mirongo itatu na bitanu."],
          ["Or ask for a custom plan, built around your business. Pay with Mobile Money, or by card.", "Cyangwa usabe gahunda yihariye, ikozwe ku bucuruzi bwawe. Wishyura na Mobile Money cyangwa ikarita."],
        ],
      },
      {
        id: "nocontract",
        visual: "PricingRW",
        demoOnly: true,
        lines: [["There's no contract. You can change or cancel your plan whenever you want.", "Nta masezerano agufunga. Ushobora guhindura cyangwa guhagarika gahunda yawe igihe ushakiye."]],
      },
      {
        id: "signup",
        visual: "SignUp",
        lines: [["Sign up with your email or Google, then add your business name, country and phone number.", "Iyandikishe ukoresheje email cyangwa Google, hanyuma wongeremo izina ry'ubucuruzi, igihugu na telefone."]],
      },
      {
        id: "onboarding",
        visual: "Onboarding",
        demoOnly: true,
        lines: [
          ["Next, tell BuPulse what you sell, who your customers are, and how you like to talk to them.", "Hanyuma, bwira BuPulse ibyo ucuruza, abakiriya bawe abo ari bo, n'uburyo ukunda kuvugana na bo."],
          ["Upload your logo, and BuPulse picks your brand colours from it. It takes less than five minutes.", "Shyiraho ikirango cyawe, BuPulse ihitemo amabara yawe. Bitwara iminota itarenze itanu."],
        ],
      },
      {
        id: "dashboard",
        visual: "Dashboard",
        demoOnly: true,
        lines: [["Your dashboard is ready, in your colours, with your logo.", "Urubuga rwawe rwiteguye, mu mabara yawe, n'ikirango cyawe."]],
      },
      {
        id: "choose",
        visual: "PlanPick",
        lines: [["Now choose the plan that fits you. Let's look at each one.", "Noneho hitamo gahunda ikubereye. Reka turebe buri imwe."]],
      },
      END,
    ],
  },
  {
    id: "02-starter",
    title: "Starter plan",
    scenes: [
      {
        id: "persona",
        visual: "Persona:inzu",
        lines: [
          ["Meet Aline. She runs Inzu Fashion, a boutique in Kimironko.", "Menya Aline. Afite iduka ry'imyenda Inzu Fashion i Kimironko."],
          ["New dresses arrive every week, but she has no time to post.", "Imyenda mishya iza buri cyumweru, ariko nta mwanya afite wo kuyamamaza."],
        ],
      },
      {
        id: "choose",
        visual: "PayMethod:starter",
        lines: [["Aline chooses the Starter plan, fifteen thousand francs a month, and picks Mobile Money.", "Aline ahitamo Starter, amafaranga ibihumbi cumi na bitanu ku kwezi, agahitamo Mobile Money."]],
      },
      {
        id: "nocard",
        visual: "PayMethod:starter",
        demoOnly: true,
        lines: [["No card needed. You can pay with MoMo or Airtel Money.", "Nta karita ikenewe. Ushobora kwishyura na MoMo cyangwa Airtel Money."]],
      },
      {
        id: "momo",
        visual: "MomoPay:starter",
        lines: [
          ["BuPulse shows the MoMo Pay code, the amount, and a payment reference.", "BuPulse imwereka kode ya MoMo Pay, amafaranga, na nimero y'ubwishyu."],
          ["She pays on her phone, like any other payment.", "Yishyura kuri telefone ye, nk'uko asanzwe yishyura."],
        ],
      },
      {
        id: "reference",
        visual: "MomoPay:starter",
        demoOnly: true,
        lines: [["The reference helps us find her payment quickly, so her plan starts sooner.", "Iyo nimero idufasha kubona ubwishyu bwe vuba, gahunda ye igatangira vuba."]],
      },
      {
        id: "paid",
        visual: "Waiting:starter",
        lines: [["Then she taps I've paid, and enters the transaction ID. Approval usually takes a few minutes.", "Hanyuma akanda \"Narishyuye\", akandika nimero y'igikorwa. Kwemezwa bitwara iminota mike."]],
      },
      {
        id: "approve",
        visual: "OwnerApprove:starter",
        lines: [["On our side, the payment arrives. We check the message, open the BuPulse admin, and approve.", "Natwe, amafaranga aratugeraho. Turebe ubutumwa, dufungure BuPulse admin, twemeze."]],
      },
      {
        id: "active",
        hold: 1.6,
        visual: "PlanActive:starter",
        lines: [["Aline's Starter plan is now active.", "Gahunda ya Starter ya Aline irakora."]],
      },
      {
        id: "project",
        visual: "Screen:inzu/project",
        lines: [["Now the fun part. Aline adds a new product: a kitenge summer dress, with three photos.", "Noneho igice cyiza. Aline yongeramo igicuruzwa gishya: ikanzu ya kitenge, n'amafoto atatu."]],
      },
      {
        id: "generate",
        visual: "Screen:inzu/content",
        lines: [["One click, and BuPulse writes an Instagram caption with hashtags, a thirty-second video script, and three ad headlines, in her brand voice.", "Akanda rimwe, BuPulse ikandika amagambo ya Instagram na hashtags, inyandiko ya videwo y'amasegonda mirongo itatu, n'imitwe itatu y'amatangazo, mu ijwi ry'ubucuruzi bwe."]],
      },
      {
        id: "voice",
        visual: "Screen:inzu/content",
        demoOnly: true,
        lines: [["Because BuPulse learned her shop at sign-up, every caption sounds like Aline, not like a robot. It can even write in Kinyarwanda.", "Kubera ko BuPulse yamenye iduka rye igihe yiyandikishaga, buri nyandiko yumvikana nk'iya Aline, si iy'imashini. Ishobora no kwandika mu Kinyarwanda."]],
      },
      {
        id: "design",
        visual: "Screen:inzu/design",
        lines: [["It also makes a branded design with her logo and colours, ready to post.", "Ikora kandi ifoto y'itangazo ifite ikirango n'amabara ye, yiteguye gushyirwa ku mbuga."]],
      },
      {
        id: "edit",
        visual: "Screen:inzu/content-edit",
        demoOnly: true,
        lines: [["She can change any word, generate again, or go back to an earlier version.", "Ashobora guhindura ijambo iryo ari ryo ryose, kongera gukora, cyangwa gusubira ku yabanje."]],
      },
      {
        id: "gallery",
        visual: "Screen:inzu/gallery",
        demoOnly: true,
        lines: [["Her photos stay organised in the gallery, in folders.", "Amafoto ye abikwa neza mu bubiko, mu dufunguzo."]],
      },
      {
        id: "calendar",
        visual: "Screen:inzu/calendar",
        lines: [["She moves the post to Friday at six in the evening, and it's scheduled.", "Ashyira itangazo ku wa Gatanu saa kumi n'ebyiri z'umugoroba, rigategurwa."]],
      },
      {
        id: "publish",
        visual: "Screen:inzu/calendar",
        demoOnly: true,
        lines: [["When the time comes, BuPulse posts it for her. Or, if she prefers, it reminds her with the caption and photo ready to share.", "Igihe nikigera, BuPulse irayimushyirira. Cyangwa, abishatse, ikamwibutsa amagambo n'ifoto byiteguye."]],
      },
      {
        id: "usage",
        visual: "Screen:inzu/usage",
        demoOnly: true,
        lines: [["Starter includes sixty AI texts and thirty designs every month, and she always sees what's left.", "Starter irimo inyandiko mirongo itandatu za AI n'amafoto mirongo itatu buri kwezi, kandi ahora abona ibisigaye."]],
      },
      {
        id: "upsell",
        visual: "Upsell:business",
        lines: [["Need more? Move to Business, or ask for a custom plan.", "Ukeneye ibirenzeho? Jya kuri Business, cyangwa usabe gahunda yihariye."]],
      },
      END,
    ],
  },
  {
    id: "03-business",
    title: "Business plan",
    scenes: [
      {
        id: "persona",
        visual: "Persona:urugo",
        lines: [["Meet Eric from Urugo Homes, a real estate agency in Kigali. Fifteen properties to promote, and a team of three.", "Menya Eric wo muri Urugo Homes, ikigo gicuruza amazu i Kigali. Amazu cumi n'atanu yo kwamamaza, n'itsinda ry'abantu batatu."]],
      },
      {
        id: "pay",
        hold: 1.4,
        visual: "QuickPay:business",
        lines: [["Eric chooses Business, thirty-five thousand francs a month. He pays with Mobile Money, we approve, and his plan is active.", "Eric ahitamo Business, ibihumbi mirongo itatu na bitanu ku kwezi. Yishyura na Mobile Money, tukemeza, gahunda ye igatangira."]],
      },
      {
        id: "team",
        visual: "Screen:urugo/team",
        lines: [["Business is made for teams. Eric invites two colleagues, and gives each one a role.", "Business yagenewe amatsinda. Eric atumira bagenzi be babiri, buri wese akamuha inshingano."]],
      },
      {
        id: "roles",
        visual: "Screen:urugo/team",
        demoOnly: true,
        lines: [["Admins can do everything except billing. Members create and schedule posts, and see new leads.", "Abayobozi bashobora gukora byose uretse kwishyura. Abanyamuryango bakora amatangazo, bakayategura, kandi bakabona abakiriya bashya."]],
      },
      {
        id: "listing",
        visual: "Screen:urugo/projects",
        lines: [["Every property becomes a project, with photos, price and key features.", "Buri nzu iba umushinga, ufite amafoto, igiciro n'ibiyiranga."]],
      },
      {
        id: "content",
        visual: "Screen:urugo/content",
        lines: [["BuPulse writes the caption, the video script and the headlines, and makes a Just listed design.", "BuPulse yandika amagambo, inyandiko ya videwo n'imitwe, ikanakora ifoto ya \"Bishya ku isoko\"."]],
      },
      {
        id: "volume",
        visual: "Screen:urugo/design",
        lines: [["Business includes two hundred AI texts and one hundred designs a month.", "Business irimo inyandiko magana abiri za AI n'amafoto ijana buri kwezi."]],
      },
      {
        id: "channels",
        visual: "Screen:urugo/channels",
        lines: [["Eric connects Facebook and Instagram, with one click each.", "Eric ahuza Facebook na Instagram, akanze rimwe kuri buri rubuga."]],
      },
      {
        id: "composer",
        visual: "Screen:urugo/composer",
        demoOnly: true,
        lines: [["Before posting, he sees how the post will look on each network, and BuPulse checks the length and the photos.", "Mbere yo gushyiraho, abona uko itangazo rizagaragara kuri buri rubuga, BuPulse ikagenzura uburebure n'amafoto."]],
      },
      {
        id: "variants",
        visual: "Screen:urugo/composer",
        demoOnly: true,
        lines: [["Each network gets its own version: a short caption with photos for Instagram and Facebook, and a longer business post for LinkedIn.", "Buri rubuga rubona uburyo bwarwo: amagambo make n'amafoto kuri Instagram na Facebook, n'inyandiko ndende kuri LinkedIn."]],
      },
      {
        id: "calendar",
        visual: "Screen:urugo/calendar",
        lines: [["He plans the whole week in the calendar. At the chosen time, each post goes live on its own.", "Ategura icyumweru cyose. Igihe cyagenwe nikigera, buri tangazo rijyaho ubwaryo."]],
      },
      {
        id: "results",
        visual: "Screen:urugo/calendar",
        demoOnly: true,
        lines: [["The next day, he sees the views, likes and comments of each post, right in BuPulse.", "Bukeye, abona abarebye, abakunze n'ibitekerezo kuri buri tangazo, muri BuPulse."]],
      },
      {
        id: "reminder",
        visual: "Reminder",
        demoOnly: true,
        lines: [["Before the month ends, BuPulse reminds him to pay for the next month. No surprises.", "Mbere y'uko ukwezi kurangira, BuPulse imwibutsa kwishyura ukwezi gukurikira. Nta gutungurwa."]],
      },
      {
        id: "upsell",
        visual: "Upsell:custom",
        lines: [["Want a website chat that catches new buyers, or Autopilot that plans your week? Ask for a custom plan.", "Urashaka ikiganiro ku rubuga rwawe kizana abaguzi bashya, cyangwa Autopilot igutegurira icyumweru? Saba gahunda yihariye."]],
      },
      END,
    ],
  },
  {
    id: "04-custom",
    title: "Custom plan",
    scenes: [
      {
        id: "persona",
        visual: "Persona:nova",
        lines: [["This is Patrick, from Nova Phones Kigali. Customers ask him questions all day, and he wants his pages to grow without losing his whole day.", "Uyu ni Patrick wo muri Nova Phones Kigali. Abakiriya bamubaza ibibazo umunsi wose, kandi ashaka ko imbuga ze zikura atataye umunsi we wose."]],
      },
      {
        id: "request",
        visual: "CustomRequest",
        lines: [["Patrick asks for a custom plan. He describes his shop, his goals, and the features he wants.", "Patrick asaba gahunda yihariye. Asobanura iduka rye, intego ze, n'ibyo yifuza."]],
      },
      {
        id: "booking",
        visual: "Booking",
        lines: [["Then he picks a time for a short online meeting. The Google Meet invitation arrives straight away.", "Hanyuma ahitamo igihe cy'inama ngufi kuri internet. Ubutumire bwa Google Meet buhita buza."]],
      },
      {
        id: "meeting",
        visual: "Meeting",
        demoOnly: true,
        lines: [["In the meeting, we listen first, then build the plan around his shop.", "Mu nama, tubanza kumva, hanyuma tugakora gahunda ijyanye n'iduka rye."]],
      },
      {
        id: "builder",
        visual: "CustomBuilder",
        lines: [
          ["In the BuPulse admin, we open Nova Phones and add features. When we add Autopilot, everything it needs comes with it.", "Muri BuPulse admin, dufungura Nova Phones tukongeramo serivisi. Iyo twongeyemo Autopilot, ibyo ikenera byose biza hamwe na yo."],
          ["We add the website chat with WhatsApp alerts, three hundred AI photo designs a month, analytics, and our team to manage his pages. The price adds up as we go.", "Twongeramo ikiganiro ku rubuga n'ubutumwa bwa WhatsApp, amafoto magana atatu ya AI buri kwezi, isesengura, n'itsinda ryacu ricunga imbuga ze. Igiciro kiyongera uko tugenda."],
        ],
      },
      {
        id: "offer",
        visual: "Offer",
        lines: [["Patrick receives the offer, accepts it, and pays with Mobile Money. Once we approve, his custom plan switches on.", "Patrick yakira icyifuzo, akacyemera, akishyura na Mobile Money. Tumaze kwemeza, gahunda ye yihariye iratangira."]],
      },
      {
        id: "payforneed",
        visual: "Offer",
        demoOnly: true,
        lines: [["He only pays for what he needs, and can add more later as the shop grows.", "Yishyura gusa ibyo akeneye, kandi ashobora kongeraho ibindi uko iduka rikura."]],
      },
      {
        id: "instagram",
        hold: 2.2,
        visual: "InstagramConnect",
        lines: [["He connects Instagram in a few seconds.", "Ahuza Instagram mu masegonda make."]],
      },
      {
        id: "autopilot",
        visual: "Autopilot",
        lines: [["Autopilot plans next week for him: new arrivals, offers and tips, each with a design. Patrick approves them all with one tap, and they post on schedule.", "Autopilot imutegurira icyumweru gitaha: ibyagezeho bishya, poromosiyo n'inama, buri kimwe gifite ifoto. Patrick abyemeza byose akanze rimwe, bikajyaho ku gihe."]],
      },
      {
        id: "aiphoto",
        visual: "AiPhoto",
        lines: [["AI photo designs turn a simple phone photo into a branded offer poster.", "Amafoto ya AI ahindura ifoto isanzwe ya telefone mo itangazo ry'ubucuruzi bwe."]],
      },
      {
        id: "chat",
        visual: "WebsiteChat",
        lines: [
          ["On his website, a visitor asks if the Samsung A56 is in stock. The chat answers from Patrick's own information, then asks for a name and phone number.", "Ku rubuga rwe, umushyitsi abaza niba Samsung A56 ihari. Ikiganiro gisubiza gikoresheje amakuru ya Patrick, hanyuma kikamubaza izina na telefone."],
          ["Patrick gets a WhatsApp alert, and the lead is waiting in BuPulse.", "Patrick yakira ubutumwa kuri WhatsApp, kandi umukiriya amutegereje muri BuPulse."],
        ],
      },
      {
        id: "leads",
        visual: "Screen:nova/leads",
        demoOnly: true,
        lines: [["In the leads inbox, he marks each one as new, contacted, won or lost, and can export them any time.", "Mu bubiko bw'abakiriya, ashyira buri wese aho ari: mushya, yavuganywe, yaguze cyangwa ntiyaguze, kandi ashobora kubikuramo igihe cyose."]],
      },
      {
        id: "managed",
        visual: "Managed",
        demoOnly: true,
        lines: [["With Managed by BuPulse, our team creates and posts for him every week.", "Na Managed by BuPulse, itsinda ryacu rimukorera kandi rigashyiraho amatangazo buri cyumweru."]],
      },
      {
        id: "analytics",
        visual: "Screen:nova/analytics",
        lines: [["Analytics show his reach, his best posts, and his new leads every week.", "Isesengura rimwereka abo yageraho, amatangazo meza, n'abakiriya bashya buri cyumweru."]],
      },
      {
        id: "soon",
        visual: "ComingSoon",
        lines: [["Coming soon: an online store built from his products, and an ads manager to promote a new phone in a few clicks.", "Biri hafi: iduka rya internet rikozwe mu bicuruzwa bye, n'uburyo bwo kwamamaza telefone nshya mu kanya gato."]],
      },
      END,
    ],
  },
  {
    id: "05-card",
    title: "Paying by card",
    scenes: [
      {
        id: "choose",
        visual: "PayMethod:card",
        lines: [["Prefer paying by card? Choose your plan, then Card.", "Ukunda kwishyura n'ikarita? Hitamo gahunda, hanyuma uhitemo Ikarita."]],
      },
      {
        id: "price",
        visual: "PayMethod:card",
        demoOnly: true,
        lines: [["The card price includes the card costs, so Mobile Money is a little cheaper.", "Igiciro cy'ikarita kirimo amafaranga y'ikarita, bityo Mobile Money ihendutseho gato."]],
      },
      {
        id: "checkout",
        visual: "CardCheckout",
        lines: [["The card price is shown in dollars, next to the price in francs. Pay in the secure checkout.", "Igiciro cy'ikarita kigaragara mu madolari, iruhande rw'igiciro mu mafaranga. Wishyura mu buryo bwizewe."]],
      },
      {
        id: "secure",
        visual: "CardCheckout",
        demoOnly: true,
        lines: [["Card payments are handled by Paddle, a global payment company. BuPulse never sees your card number.", "Kwishyura n'ikarita bikorwa na Paddle, ikigo mpuzamahanga cy'ubwishyu. BuPulse ntibona nimero y'ikarita yawe."]],
      },
      {
        id: "active",
        hold: 1.6,
        visual: "PlanActive:card",
        lines: [["Your plan is active straight away. No waiting.", "Gahunda yawe ihita itangira. Nta gutegereza."]],
      },
      {
        id: "renew",
        visual: "Renewal",
        lines: [["Every month it renews automatically, and the receipt comes to your email. Change your plan, or cancel any time.", "Buri kwezi yivugurura ubwayo, inyemezabwishyu ikaza kuri email yawe. Hindura gahunda cyangwa uyihagarike igihe ushakiye."]],
      },
      {
        id: "switch",
        visual: "SwitchMethod",
        demoOnly: true,
        lines: [["You can also switch to Mobile Money at your next renewal.", "Ushobora kandi kwimukira kuri Mobile Money igihe cyo kwishyura gikurikira."]],
      },
      END,
    ],
  },
];

/** Spoken chapter titles placed before each part of the full walkthrough (00-full). */
export const CHAPTERS: Record<string, Scene> = {
  "02-starter": { id: "ch-starter", visual: "Chapter:starter", hold: 0.8, lines: [["Let's start with the Starter plan.", "Reka duhere kuri gahunda ya Starter."]] },
  "03-business": { id: "ch-business", visual: "Chapter:business", hold: 0.8, lines: [["Next, the Business plan, made for teams.", "Ubu, gahunda ya Business, yagenewe amatsinda."]] },
  "04-custom": { id: "ch-custom", visual: "Chapter:custom", hold: 0.8, lines: [["Now, a custom plan, built around your business.", "Noneho, gahunda yihariye, ikozwe ku bucuruzi bwawe."]] },
  "05-card": { id: "ch-card", visual: "Chapter:card", hold: 0.8, lines: [["Finally, paying by card.", "Hanyuma, kwishyura n'ikarita."]] },
};

export const FULL_ID = "00-full";
