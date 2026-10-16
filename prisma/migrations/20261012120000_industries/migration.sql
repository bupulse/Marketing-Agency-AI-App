-- Industries as data (docs/INDUSTRIES.md). Adds the Industry table with the guidance the AI writes from, the sign-up
-- fields on Business (sector, "Other" text, description) and the dismissed-suggestion list. Columns are added nullable,
-- nothing is dropped or rewritten: Business.industry stays as it is (deprecated, still written) so analytics, the
-- Autopilot playbook tags and the design packs keep working. Existing companies are linked to a sector by name.

-- ---- Tables --------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Industry" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "customers" TEXT NOT NULL,
    "offerings" TEXT NOT NULL,
    "postIdeas" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "hashtags" TEXT[],
    "seasons" TEXT NOT NULL,
    "avoid" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Industry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Industry_slug_key" ON "Industry"("slug");

CREATE TABLE IF NOT EXISTS "DismissedIndustrySuggestion" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DismissedIndustrySuggestion_pkey" PRIMARY KEY ("key")
);

-- ---- Business: the sector, the "Other" text and the sign-up description -----------------------------------------------
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "industryId" TEXT;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "industryOther" TEXT;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "industryDescription" TEXT;
CREATE INDEX IF NOT EXISTS "Business_industryId_idx" ON "Business"("industryId");
DO $$ BEGIN
  ALTER TABLE "Business" ADD CONSTRAINT "Business_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Same rules as the other internal tables: RLS on, no access for anon, authenticated or service_role (Prisma connects as postgres).
ALTER TABLE "Industry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DismissedIndustrySuggestion" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Industry", "DismissedIndustrySuggestion" FROM PUBLIC, anon, authenticated, service_role;

-- ---- Seeds: the sectors offered at sign-up and on the marketing /industries page (lib/content/site.ts) -----------------
-- Written for Rwanda and East Africa first: RWF, Kigali, the local calendar (Umuganda, Kwibuka, Kwibohora, Umuganura,
-- the rainy seasons, school terms) and what each sector must not claim. Editable at Admin -> Industries.
INSERT INTO "Industry" ("id", "slug", "name", "shortDescription", "customers", "offerings", "postIdeas", "tone", "hashtags", "seasons", "avoid", "active", "sortOrder", "updatedAt") VALUES
(
  'ind_retail', 'retail', 'Shops & retail',
  $q$Shops and boutiques selling everyday goods, fashion, gifts and household items, in person and through WhatsApp or Instagram.$q$,
  $q$Families and young professionals in Kigali and the secondary cities; shoppers who browse on Instagram and order by WhatsApp; month-end buyers (salaries land around the 25th); diaspora relatives sending gifts home.$q$,
  $q$Clothing and kitenge fashion, shoes, bags and accessories, home and kitchen goods, cosmetics, baby items, gifts and decorations, phone top-ups and small electronics; delivery by moto within Kigali; MoMo and card payment in store.$q$,
  $q$New arrivals with real photos; "back in stock"; weekend and month-end deals; one product, three ways to wear or use it; behind the counter (a day in the shop); customer favourites of the week; how to order on WhatsApp and get moto delivery; gift ideas before Christmas, Valentine's and Mother's Day; care tips (washing kitenge, keeping leather).$q$,
  $q$Warm, friendly and concrete. Short sentences, a clear price when the owner gives one, one call to action (visit, WhatsApp, order). Kinyarwanda or French greetings are welcome when the brand uses them.$q$,
  ARRAY['#Kigali', '#Rwanda', '#MadeInRwanda', '#KigaliShopping', '#ShopLocal', '#NewArrivals', '#KigaliFashion', '#RwOT'],
  $q$Month-end (25th to 5th) is the buying peak; Christmas and New Year (gifts, travel to the village, new clothes); Valentine's Day (14 Feb); Easter; Mother's Day (May); back-to-school in late August/September and January (uniforms, shoes, bags); Umuganura (first Friday of August) and Kwibohora (4 July) for "Made in Rwanda" pride; Black Friday is growing in Kigali; the rainy seasons (March to May, October to December) sell umbrellas, boots and jackets; Umuganda (last Saturday of the month) keeps shops closed until about 11:00; during Kwibuka (7 to 13 April) no promotions or celebratory posts.$q$,
  $q$Never invent prices, discounts or stock levels. "Original", "genuine" or "imported from Europe" only when the owner says so. No "cheapest in Kigali" or "best shop in Rwanda" superlatives. Single-use plastic bags are banned in Rwanda: do not show or offer them. Every sale needs an EBM receipt (RRA); do not suggest cash deals without one. No counterfeit brands.$q$,
  true, 10, CURRENT_TIMESTAMP
),
(
  'ind_electronics', 'electronics', 'Phones & electronics',
  $q$Shops selling and repairing phones, laptops, TVs, accessories and small appliances, often with trade-ins and MoMo instalments.$q$,
  $q$Students and young professionals upgrading phones; families buying a TV or fridge; small businesses needing laptops, printers and routers; people whose screen or battery needs fixing today; buyers comparing prices between Kigali shops on Instagram.$q$,
  $q$New and refurbished phones (Samsung, Tecno, Infinix, iPhone), laptops, TVs, speakers, chargers and cases, SIM and data bundles, screen and battery repairs, software and data transfer, trade-ins, instalment plans through partners, warranty on new devices.$q$,
  $q$"Just arrived" with the exact model and what is in the box; a 30-second spec walkthrough; repair before-and-after (screen, battery); "is it worth upgrading?" explainers; how to spot a fake charger; trade-in offer of the week; what a warranty covers; back-to-school laptop bundles; data-saving tips; customer questions answered (does it support 4G, dual SIM?).$q$,
  $q$Clear, knowledgeable and honest. Specs in plain words, no jargon walls. Confident but never pushy; reassure about warranty, repairs and support after the sale.$q$,
  ARRAY['#KigaliTech', '#Rwanda', '#Kigali', '#PhonesRwanda', '#TechRwanda', '#GadgetsKigali', '#RwOT', '#Repair'],
  $q$Back-to-school (late August/September and January) for laptops and phones; Christmas and New Year gifting; month-end (25th to 5th) spending; new flagship launches (Samsung early in the year, iPhone in September); exam results and graduations (phones as gifts); Black Friday in November; the rainy seasons bring water-damage repairs; Kwibohora (4 July) and Umuganura (first Friday of August) for Made-in-Rwanda assembled phones; no promotions during Kwibuka (7 to 13 April).$q$,
  $q$Never invent prices, specs, stock, warranty terms or instalment conditions. "Original" or "brand new, sealed" only when true; say "refurbished" when it is. No claims about network coverage or RURA approval unless the owner provides them. No "unlockable", "untraceable" or grey-market language. Do not promise repair times or data recovery results. Devices must be tax-cleared (RRA); never suggest otherwise.$q$,
  true, 20, CURRENT_TIMESTAMP
),
(
  'ind_it', 'it', 'IT & software',
  $q$IT companies, software studios and freelancers building websites, apps and systems, and keeping businesses' computers and networks running.$q$,
  $q$Small and medium businesses in Kigali that need a website, a system or someone to call when the network is down; schools, clinics, NGOs and cooperatives going digital; start-ups needing a product built; owners who want to accept MoMo and card payments online.$q$,
  $q$Websites and e-commerce, mobile apps, custom systems (inventory, school management, bookings), MoMo and payment integrations, managed IT support, networking and Wi-Fi, cloud and email setup, cybersecurity basics, training, maintenance contracts.$q$,
  $q$One problem we solved this month (with the client's permission, no numbers invented); plain-language explainers (what hosting is, why backups matter); a free IT check offer; "before you buy a system, ask these 5 questions"; behind the build (a feature in progress); team spotlight; how MoMo payments work online; security tips for small businesses (passwords, phishing); meetup or hackathon recaps.$q$,
  $q$Professional, clear and helpful. Explain, don't impress. Short paragraphs, concrete examples, no acronyms without a plain-word version. Reassuring about support and timelines without promising dates the owner has not given.$q$,
  ARRAY['#KigaliTech', '#TechRwanda', '#RwandaTech', '#Kigali', '#SmallBusiness', '#DigitalRwanda', '#WebDesign', '#ITSupport'],
  $q$January and July (new budgets, new systems); the start of school terms for school-management systems (September, January); tax-filing periods (RRA deadlines in March for annual returns, monthly VAT) for accounting systems; Transform Africa Summit and Kigali tech events; Africa Code Week (October); Umuganura (first Friday of August) for Made-in-Rwanda software; year-end security reminders; nothing promotional during Kwibuka (7 to 13 April).$q$,
  $q$Never promise "100% secure", "unhackable", "guaranteed first on Google" or fixed delivery dates the owner did not give. No invented client names, case-study numbers or testimonials. Do not claim partnerships or certifications (Microsoft, Google, ISO) unless provided. Respect client confidentiality: no screenshots of client data. Data protection law applies in Rwanda (NCSA): do not promise to collect or share personal data loosely.$q$,
  true, 30, CURRENT_TIMESTAMP
),
(
  'ind_construction', 'construction', 'Construction',
  $q$Builders, contractors, architects and tradespeople: houses, renovations, roofing, plumbing, electrical and finishing work.$q$,
  $q$Families building or extending a home in Kigali and the districts; diaspora Rwandans building back home and following progress by WhatsApp; landlords renovating rentals; small businesses fitting out a shop or office; people who need a plumber or electrician this week.$q$,
  $q$House construction, renovations and extensions, roofing, tiling and finishing, plumbing and electrical, painting, fencing and gates, boreholes and water tanks, architectural drawings and permits, cost estimates and site visits, project supervision for clients abroad.$q$,
  $q$Project complete, with before-and-after photos; a weekly site update (foundation, roofing, finishing); "what a permit needs in Kigali" explainers; materials tips (why good cement matters, roofing choices for the rains); meet the team; free site visit offer; how we keep clients abroad updated; a finished detail (tiles, kitchen, gate); safety on site; rainy-season preparation.$q$,
  $q$Trustworthy, steady and practical. Show the work, explain the process, respect budgets. No hype; confidence comes from photos and clear steps.$q$,
  ARRAY['#Kigali', '#Rwanda', '#ConstructionRwanda', '#BuildInRwanda', '#KigaliHomes', '#Renovation', '#Roofing', '#Architecture'],
  $q$Dry seasons (June to September, and December to February) are the building seasons; the long rains (March to May) and short rains (October to December) mean roofing, drainage and waterproofing posts; December brings diaspora visits and new projects; January for new-year budgets and permits; Umuganda (last Saturday of the month) is community building time; Kwibohora (4 July) and Umuganura for Made-in-Rwanda materials; no promotions during Kwibuka (7 to 13 April).$q$,
  $q$Never quote prices, timelines or square-metre rates the owner did not give. Do not claim permits, City of Kigali or RHA approvals, engineer registration or insurance unless provided. No "guaranteed no cracks / lifetime" claims. Do not show unsafe work (no helmets, no harnesses). Do not invent client names or locations; ask before showing a client's home.$q$,
  true, 40, CURRENT_TIMESTAMP
),
(
  'ind_schools', 'schools', 'Schools & training',
  $q$Nursery, primary and secondary schools, TVET and language centres, tutoring, driving schools and professional training.$q$,
  $q$Parents in Kigali and the districts choosing a school or after-school programme; young adults seeking skills for work (languages, IT, driving, tailoring, hospitality); professionals upgrading (English, accounting, software); companies training staff.$q$,
  $q$Nursery to secondary education, boarding and day options, TVET courses, English, French and Kinyarwanda classes, computer and coding classes, driving lessons, exam preparation, holiday camps, professional certificates, school transport and meals.$q$,
  $q$Enrolment open with dates and what to bring; open day invitations; a day in the life of a class (with consent); teacher spotlight; student achievements (no grades or numbers invented); course launch and what you will learn; parents' questions answered (fees structure only if given, timetable, transport); holiday camp announcements; exam-season tips for parents; graduation moments.$q$,
  $q$Caring, encouraging and clear. Speak to parents' hopes and learners' goals. Calm authority, no pressure, no exaggerated promises about results.$q$,
  ARRAY['#Kigali', '#Rwanda', '#EducationRwanda', '#KigaliSchools', '#LearnInKigali', '#Training', '#SkillsForJobs', '#RwandaEducation'],
  $q$The school year starts in September with terms ending around December, late March/April and July; enrolment and back-to-school peaks in late August/September and early January; national exams and results (primary and secondary) around July to September; holiday camps in April, July/August and December; language and professional courses fill in January and after graduations; International Day of Education (24 January), Teachers' Day (5 October), Day of the African Child (16 June); Kwibuka (7 to 13 April) is a time for remembrance, not promotion.$q$,
  $q$Never guarantee exam results, pass rates, university admission or jobs. Do not claim MINEDUC/REB, HEC, WDA or RTB accreditation, Cambridge or IB status unless the owner provides it. No photos of children without consent; never name a child. Do not invent fees, scholarship terms or teacher qualifications. Avoid comparing with named other schools.$q$,
  true, 50, CURRENT_TIMESTAMP
),
(
  'ind_restaurants', 'restaurants', 'Restaurants & cafés',
  $q$Restaurants, cafés, bars, bakeries, fast food, caterers and food delivery kitchens.$q$,
  $q$Kigali's lunch crowd and after-work groups; families on weekends; young people meeting friends at cafés; tourists and expats looking for local and international food; offices ordering lunch; event hosts needing catering (weddings, meetings, birthdays).$q$,
  $q$Rwandan dishes (brochettes, isombe, ibihaza, akabenz), grills and buffets, pizza and burgers, coffee and pastries, fresh juices, breakfast and brunch, lunch specials, catering and platters, delivery (own moto or Vuba Vuba), private events and live music nights.$q$,
  $q$The dish of the day with a real photo; weekend brunch or buffet; new menu item; behind the kitchen (the chef, the coffee roast); live music or match nights; how to order delivery; catering for your event; happy hour (only when the owner gives it); customer favourites; a tip on Rwandan coffee; the team at work; holiday menus (Christmas, New Year, Eid, Easter).$q$,
  $q$Appetising, warm and lively. Describe taste, smell and the moment; invite people in. Short, sensory sentences; one clear call to action (book, order, come by).$q$,
  ARRAY['#KigaliFood', '#KigaliEats', '#Rwanda', '#Kigali', '#RwandanFood', '#RwandaCoffee', '#Brochettes', '#VisitRwanda'],
  $q$Friday and Saturday evenings and Sunday lunch are the peaks; month-end (25th to 5th) is busier; Christmas and New Year parties and family lunches; Valentine's Day (14 Feb) dinners; Easter and Eid (al-Fitr and al-Adha) family meals; Kwibohora (4 July) and Umuganura (first Friday of August) harvest and national dishes; the rainy seasons (March to May, October to December) favour hot drinks, soups and delivery; Kigali International Peace Marathon (May/June) and Car-Free Day Sundays bring brunch crowds; Ramadan changes hours for some customers; during Kwibuka (7 to 13 April) no parties, music or promotions.$q$,
  $q$Never invent prices, opening hours or delivery areas. No health claims ("detox", "cures", "burns fat"). Alcohol: never target or show minors, no "drink more" messaging, keep it to adults and responsible wording. Do not claim "best in Kigali" or hygiene ratings unless provided. Respect dietary labels: only say halal, vegan or gluten-free when the owner confirms it. EBM receipts are required for every sale.$q$,
  true, 60, CURRENT_TIMESTAMP
),
(
  'ind_beauty', 'beauty', 'Salons & beauty',
  $q$Hair salons, barbershops, nail studios, spas, make-up artists and beauty shops.$q$,
  $q$Women and men in Kigali booking hair, nails and grooming before the weekend, weddings and events; brides and bridal parties; professionals wanting a quick lunchtime appointment; customers who follow styles on Instagram and TikTok and book by WhatsApp.$q$,
  $q$Braids, weaves, locs and natural hair care, cuts and barbering, colour, manicures and pedicures, make-up for events and weddings, facials and massages, lash and brow services, hair and skin products, bridal packages, home visits.$q$,
  $q$Before-and-after looks (with consent); the style of the week; booking slots left for the weekend; bridal season packages; product tips (protective styles for the rainy season); meet the stylist; a 15-second transformation video; gift vouchers for Valentine's, Mother's Day and Christmas; how to care for your braids; new service launch; client appreciation (first name only, with permission).$q$,
  $q$Stylish, confident and personal. Compliment the client, celebrate the look, make booking easy. Friendly emojis fit most beauty brands.$q$,
  ARRAY['#KigaliSalon', '#KigaliHair', '#Rwanda', '#Kigali', '#Braids', '#NaturalHair', '#KigaliBeauty', '#RwandaBride'],
  $q$Fridays and Saturdays are the peak; the wedding season runs through the dry months (June to September, December to February); Christmas and New Year, Valentine's Day (14 Feb), Mother's Day (May), Easter and Eid mean full books and gift vouchers; graduation season (July to October); back-to-school haircuts (late August/September, January); the rainy seasons (March to May, October to December) suit protective styles and treatments; no promotions or celebratory posts during Kwibuka (7 to 13 April).$q$,
  $q$Never promise results ("hair grows 5 cm", "removes all dark spots", "permanent"). No skin-lightening or bleaching promotion (the products are banned in Rwanda). Do not claim products are "dermatologist approved" or "organic" unless the owner provides it. No before-and-after photos without the client's consent; never name clients. Do not invent prices or durations.$q$,
  true, 70, CURRENT_TIMESTAMP
),
(
  'ind_health', 'health', 'Clinics & health',
  $q$Private clinics, dental and eye clinics, pharmacies, physiotherapy, maternity and wellness practices.$q$,
  $q$Families in Kigali looking for a trusted clinic nearby; parents of young children; expectant mothers; working adults needing a check-up, dental care or glasses; people with insurance (RSSB, Mutuelle, private) asking what is covered; companies arranging staff check-ups.$q$,
  $q$General consultations, paediatrics, dental care, eye tests and glasses, laboratory tests, antenatal care, vaccinations, physiotherapy, pharmacy and over-the-counter advice, health check packages, home visits where offered, insurance accepted (only as the owner lists them).$q$,
  $q$New service or new doctor joining (with their consent); opening hours and how to book; general health tips (hydration, hand washing, dental care, sleep) with no diagnosis; "when should you see a doctor about…" general guidance that ends with "come and ask"; insurance accepted; children's vaccination schedule reminders (general); seasonal advice (malaria prevention in the rains, dust and allergies in the dry season); a tour of the clinic; health days (World Health Day, Malaria Day); patient-friendly explainers.$q$,
  $q$Calm, caring and trustworthy. Simple words, no fear or urgency tactics, no diagnosis. Always invite people to come in or call rather than self-treat.$q$,
  ARRAY['#Kigali', '#Rwanda', '#HealthRwanda', '#KigaliClinic', '#Wellness', '#Dentist', '#FamilyHealth', '#HealthyRwanda'],
  $q$Malaria and flu rise in the rainy seasons (March to May, October to December); dust, allergies and eye irritation in the dry season (June to September); back-to-school check-ups and vaccinations (late August/September, January); World Health Day (7 April, overlaps with Kwibuka: keep it sober), World Malaria Day (25 April), World Oral Health Day (20 March), Breast Cancer Awareness (October), World AIDS Day (1 December), Mental Health Day (10 October); year-end and January for health check packages; Kwibuka (7 to 13 April): support and remembrance only, no promotions.$q$,
  $q$No medical guarantees, cure claims or outcome promises ("heals", "100% safe", "no pain"). Never diagnose or prescribe in a post; no dosage advice. Do not name or show patients, or share any patient information. Health advertising in Rwanda needs Ministry of Health / Rwanda FDA rules: no promotion of prescription medicines, no comparative or "best clinic" claims. Do not claim RSSB/Mutuelle or insurance cover unless the owner lists it. No invented doctor qualifications.$q$,
  true, 80, CURRENT_TIMESTAMP
),
(
  'ind_machinery', 'machinery', 'Machinery & equipment',
  $q$Dealers and hire companies for construction, agricultural and industrial machinery, generators, tools and spare parts.$q$,
  $q$Contractors and builders in Kigali and the districts; farmers and cooperatives mechanising (tractors, mills, irrigation pumps); factories and workshops needing parts and service; event companies and clinics needing generators; NGOs and government projects procuring equipment.$q$,
  $q$Excavators, mixers and compactors for hire or sale, tractors and farm implements, maize mills and processing machines, water pumps and irrigation, generators and solar systems, welding and workshop tools, spare parts, servicing and operator training, delivery to site.$q$,
  $q$New stock arrived with model and capacity (only facts given); hire offers for the dry-season building rush; machine of the month and what it is for; a service tip (generator maintenance before the rains); a delivery to a farm or site (with consent); how to choose the right pump or mill; spare parts in stock; operator training dates; before-and-after of a serviced machine; Made-in-Rwanda or assembled-locally stories.$q$,
  $q$Practical, technical and trustworthy. Facts, capacity, use cases. Plain language for farmers and builders alike; patient explanations, no hype.$q$,
  ARRAY['#Rwanda', '#Kigali', '#MachineryRwanda', '#AgriRwanda', '#ConstructionRwanda', '#Generators', '#FarmEquipment', '#MadeInRwanda'],
  $q$Building season in the dry months (June to September, December to February) for construction hire; land preparation before the rains (planting seasons A in September and B in February/March) for tractors and pumps; harvest (June to July, December to January) for mills and dryers; Umuganura (first Friday of August) celebrates the harvest; power cuts in the rainy seasons boost generator and solar demand; agricultural shows and the National Agriculture Show (Mulindi, around June); year-end budgets for cooperatives and NGOs; no promotions during Kwibuka (7 to 13 April).$q$,
  $q$Never invent prices, hire rates, capacities, fuel consumption or availability. No "never breaks down" or lifetime guarantees; warranty terms only as the owner gives them. Do not claim RSB certification, brand dealership status or import origin unless provided. Always show safe operation (guards, protective gear). Equipment must be tax-cleared; no hints otherwise.$q$,
  true, 90, CURRENT_TIMESTAMP
),
(
  'ind_real_estate', 'real-estate', 'Real estate',
  $q$Agents, developers and property managers selling, letting and managing houses, apartments, plots and commercial space.$q$,
  $q$Families and professionals renting or buying in Kigali (Kimihurura, Nyarutarama, Kibagabaga, Kicukiro, Kanombe and more); diaspora Rwandans buying plots or homes from abroad; expats and NGOs looking for furnished rentals; investors in apartments and commercial space; landlords wanting a manager.$q$,
  $q$Houses and apartments for rent and sale, furnished short stays, plots with land titles (UPI), commercial and office space, property management and tenant finding, valuation and viewings, help with transfer at the land office, construction supervision for buyers abroad.$q$,
  $q$Just listed with real photos and the facts given (location, bedrooms, price only if provided); video walk-through; neighbourhood guide (schools, shops, transport nearby); "what to check before buying a plot" (UPI, land title, zoning); sold or let (with consent); open viewing day; renting vs buying explainers; how diaspora buyers can view remotely; property management tips for landlords; market update in general words, no invented statistics.$q$,
  $q$Professional, honest and welcoming. Describe the home and the life around it; be exact about facts and quiet about anything not given. No pressure or false urgency.$q$,
  ARRAY['#KigaliRealEstate', '#KigaliHomes', '#Rwanda', '#Kigali', '#HouseForRent', '#HouseForSale', '#PlotsForSale', '#InvestInRwanda'],
  $q$December and January: diaspora visits, viewings and plot purchases; mid-year (June to August) relocations for NGOs, expats and new school years (September); month-end moves and rent due dates (1st); the dry seasons for viewings and construction; big conferences in Kigali (various months) fill furnished rentals; Kwibohora (4 July), Umuganura (first Friday of August); Kwibuka (7 to 13 April): no promotions.$q$,
  $q$Never invent prices, sizes, bedrooms, rental yields or "guaranteed returns". Do not claim a title, UPI, zoning or permit status unless the owner provides it. No "last chance / only today" urgency unless true. Do not show tenants or their belongings without consent; no exact addresses of occupied homes. Agents work under RDB and the land law: no promises about transfer times. Fair treatment: no wording that excludes people by nationality, religion or family status.$q$,
  true, 100, CURRENT_TIMESTAMP
),
(
  'ind_hospitality', 'hospitality', 'Hotels & travel',
  $q$Hotels, guesthouses, lodges, tour operators, travel agencies and car hire.$q$,
  $q$Visitors to Rwanda (gorilla trekking, Akagera, Lake Kivu, Kigali conferences); Rwandans and East Africans on weekend getaways and family holidays; companies booking rooms, meetings and retreats; wedding parties; travellers needing visas, flights and airport transfers; locals for Sunday lunch and pool days.$q$,
  $q$Rooms and suites, conference and meeting rooms, restaurant and pool, weddings and events, airport transfers and car hire, guided tours (Volcanoes, Nyungwe, Akagera, Lake Kivu, Kigali city tours), flight and visa help, weekend packages, day passes.$q$,
  $q$A view from the room this morning; weekend package (facts only as given); guest story or review (only real ones the owner provides); a local tip (where to see the sunset, what to pack for Nyungwe); meet the team; a dish from the restaurant; conference-ready meeting rooms; last-minute availability (only when the owner confirms); festival and event weekends; itinerary ideas (3 days in Rwanda); how to get here from the airport.$q$,
  $q$Welcoming, calm and inviting. Paint the scene, be generous with local knowledge, make booking easy. Warm rather than luxurious unless the brand is luxury.$q$,
  ARRAY['#VisitRwanda', '#Rwanda', '#Kigali', '#LakeKivu', '#Akagera', '#GorillaTrekking', '#TravelRwanda', '#EastAfricaTravel'],
  $q$Peak tourist seasons are the dry months (June to September, and mid-December to February); the long rains (March to May) and short rains (October to December) bring low-season offers and green landscapes; Kwita Izina gorilla naming (September); Kigali International Peace Marathon (May/June); Rwanda Cultural events and Umuganura (first Friday of August); Christmas and New Year, Easter and Eid getaways; conference seasons bring corporate stays; Kwibohora (4 July) long weekend; Kwibuka (7 to 13 April): respectful, no celebratory posts or promotions.$q$,
  $q$Never invent rates, availability, star ratings or "RDB-graded" status. No promises about gorilla permits, weather or wildlife sightings. Do not use guest photos or names without consent. Do not claim "eco", "sustainable" or "award-winning" unless the owner provides it. Visa and entry rules change: do not state them as facts. Alcohol: adults only, responsible wording.$q$,
  true, 110, CURRENT_TIMESTAMP
),
(
  'ind_fitness', 'fitness', 'Gyms & fitness',
  $q$Gyms, fitness studios, personal trainers, yoga and dance classes, sports clubs and swimming schools.$q$,
  $q$Young professionals in Kigali training before or after work; people starting a new routine in January; women-only or group classes; parents booking swimming and sports for children; corporate wellness programmes; runners preparing for the Kigali marathon; people returning after an injury (with medical advice).$q$,
  $q$Gym memberships and day passes, personal training, group classes (HIIT, aerobics, Zumba, yoga, boxing), swimming lessons, kids' sports, nutrition guidance (general), corporate packages, outdoor sessions and running clubs, fitness assessments.$q$,
  $q$New class launch with times; member spotlight (with consent, first name only); a trainer tip (form, warm-up, hydration); free trial pass; "start where you are" motivation; what to bring to your first class; Car-Free Day group workouts; marathon training plan announcements; schedule for the holidays; a 20-second workout demo; healthy habits for the rainy season; corporate wellness offer.$q$,
  $q$Energetic, encouraging and inclusive. Celebrate effort, not bodies. Clear, friendly instructions; no shaming, no extreme promises.$q$,
  ARRAY['#KigaliFitness', '#Rwanda', '#Kigali', '#FitRwanda', '#KigaliGym', '#CarFreeDay', '#KigaliMarathon', '#HealthyRwanda'],
  $q$January (new-year resolutions) and September (after school starts) are joining peaks; Kigali Car-Free Day (first and third Sundays) for group workouts; Kigali International Peace Marathon (May/June) training season from February; the rainy seasons (March to May, October to December) move training indoors; dry-season outdoor boot camps (June to September); holiday schedules at Christmas, Easter and Eid; Olympic Day (23 June) and sports events; no promotions during Kwibuka (7 to 13 April).$q$,
  $q$Never promise weight loss, "lose 10 kg in a month", body transformations or medical results. No before-and-after bodies without consent; never comment on a member's body. Nutrition advice stays general; no supplements or steroid talk. Do not invent membership prices, class times or trainer certifications. Encourage medical advice for health conditions.$q$,
  true, 120, CURRENT_TIMESTAMP
),
(
  'ind_services', 'services', 'Professional services',
  $q$Accountants, lawyers, consultants, marketing and design agencies, insurance brokers, HR and training firms, and other business services.$q$,
  $q$Small and medium business owners in Kigali and the districts who need help with taxes, registration, contracts, HR, insurance or marketing; start-ups formalising with RDB; cooperatives and NGOs needing audits and reports; individuals needing legal or financial advice.$q$,
  $q$Bookkeeping and tax filing (RRA, VAT, EBM), company registration (RDB), audits and financial statements, contracts and legal advice, HR and recruitment, business plans and consulting, branding and marketing, insurance brokerage, training and workshops.$q$,
  $q$A plain-language explainer (what the RRA deadline means for you, how to register with RDB); a client result in general words with permission; "three questions to ask before signing a contract"; meet the team and its expertise; free first consultation offer; a workshop or webinar announcement; a tip of the week; how we work (process, response times only if given); industry news summarised without invented figures; year-end checklist for business owners.$q$,
  $q$Professional, clear and reassuring. Plain words for complex topics, no jargon or legalese. Measured confidence, never promises of outcomes.$q$,
  ARRAY['#Kigali', '#Rwanda', '#SmallBusinessRwanda', '#KigaliBusiness', '#RwandaBusiness', '#Entrepreneurs', '#Consulting', '#RwOT'],
  $q$RRA deadlines: monthly VAT and PAYE (15th), quarterly instalments, annual income tax returns by 31 March; January for new budgets, registrations and plans; July for mid-year reviews and new fiscal-year planning; end-of-year closing and audits (December to February); Taxpayers' Appreciation Day and MSME events; Kigali conferences and trade fairs; Kwibohora (4 July) and Umuganura (first Friday of August); Kwibuka (7 to 13 April): no promotions.$q$,
  $q$Never guarantee outcomes (tax savings, winning a case, approvals, returns on investment). No invented statistics, client names or testimonials. Do not claim licences, bar membership, ICPAR or BNR/RDB accreditation unless the owner provides it. Legal and financial posts are general information, not advice: say so when it matters. Keep client matters confidential.$q$,
  true, 130, CURRENT_TIMESTAMP
)
ON CONFLICT ("slug") DO NOTHING;

-- ---- Backfill: existing companies ------------------------------------------------------------------------------------
-- A sector picked at sign-up was stored by name in Business.industry: link it. Anything else (free text, or "Other"
-- without a text) becomes the "Other" text that the admin sees as a suggestion.
UPDATE "Business" b SET "industryId" = i."id"
FROM "Industry" i
WHERE b."industryId" IS NULL AND b."industry" IS NOT NULL AND lower(trim(b."industry")) = lower(i."name");

UPDATE "Business" SET "industryOther" = trim("industry")
WHERE "industryId" IS NULL AND "industryOther" IS NULL AND "industry" IS NOT NULL AND trim("industry") <> '' AND lower(trim("industry")) <> 'other';

-- The onboarding description ("What you sell") is the closest thing existing companies have to the new sign-up field.
UPDATE "Business" SET "industryDescription" = "description"
WHERE "industryDescription" IS NULL AND "description" IS NOT NULL AND trim("description") <> '';
