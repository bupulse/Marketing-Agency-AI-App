// Templates of the Claude video engine (docs/VIDEO_ENGINE.md): a catalogue like Higgsfield's Marketing Studio and
// seedance2ai's showcase, grouped the same way (product shots, motion, 3D motion, UGC, TikTok, ads, promo posters,
// marketplace, cinematic). Each template is an art direction for the designer: layout, camera work, film look and pacing. Written
// for small businesses in Rwanda and East Africa. Data only.

export const TEMPLATE_CATEGORIES = [
  { id: "product", name: "Product shot" },
  { id: "motion", name: "Motion" },
  { id: "3d", name: "3D motion" },
  { id: "ugc", name: "UGC" },
  { id: "tiktok", name: "TikTok" },
  { id: "ads", name: "Ads" },
  { id: "promo", name: "Posters & offers" },
  { id: "marketplace", name: "Marketplace" },
  { id: "cinematic", name: "Cinematic" },
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]["id"];

export type VideoTemplate = {
  id: string;
  category: TemplateCategory;
  name: string;
  blurb: string;
  direction: string;
  /** Suggested length and hook; the owner can change them. */
  seconds?: number;
  hook?: string;
  /** Needs a presenter (AI influencer); until influencers exist, the designer uses the product and captions instead. */
  presenter?: boolean;
};

const T = (t: VideoTemplate) => t;

export const VIDEO_TEMPLATES: VideoTemplate[] = [
  // ---- Product shot
  T({ id: "product-hero", category: "product", name: "Product hero", blurb: "The product floats, turns and shines; features appear around it.", seconds: 15,
    direction: "Premium product showcase. The product photo is the hero (fit contain on a clean gradient when its background is plain; cover for lifestyle photos), depth 0.6, gentle rotate and scale keyframes so it feels alive. Feature callouts slide in beside it with thin drawn lines. Camera: slow dollyIn or orbitLeft with intensity 0.4, a focus pull from the background to the product in the first scene. Look: grade vivid or none, glow 0.25, vignette 0.3." }),
  T({ id: "studio-turntable", category: "product", name: "Studio turntable", blurb: "Like a pro studio shoot: soft light, slow orbit, clean text.", seconds: 12,
    direction: "Studio product photography in motion. Soft grey or brand-tinted gradient backgrounds, a key light (light) from the top left or right, the product photo with fit contain and turntable { spin 0.8, angle 30, reflection 0.35 } so it turns on a glossy floor with its own contact shadow. Camera orbitRight then orbitLeft, intensity 0.5, every scene. Minimal Inter text, small, at the top. Look: glow 0.3, vignette 0.35, grain 0.15." }),
  T({ id: "macro-detail", category: "product", name: "Macro details", blurb: "Extreme close-ups of textures and details, then the full product.", seconds: 12,
    direction: "Macro detail film. First scenes are tight crops of the product photos (cover, zoomTo 1.35, focusX/focusY on details) with crashZoom or dollyIn cameras and a focus pull; one word per scene. The final scene pulls back (dollyOut) to show the whole product with the name. Look: film grade, grain 0.25, vignette 0.4." }),
  T({ id: "ice-splash", category: "product", name: "Fresh splash", blurb: "Cool, fresh, energetic: bubbles and splashes for drinks and cosmetics.", seconds: 10,
    direction: "Fresh and cool. Light blue and white gradients, many small circle shapes as bubbles rising (keyframes dy -0.4 over the scene, varied sizes, depth 0.2 to 0.9 so they parallax), blob shapes as splashes behind the product. Camera craneUp intensity 0.5. Look: cool grade, glow 0.4." }),
  // ---- Motion
  T({ id: "kinetic-type", category: "motion", name: "Bold words", blurb: "Huge words punch in on the beat; photos flash between them.", seconds: 10, hook: "bold-claim",
    direction: "Kinetic typography. Short scenes (1.2 to 2 s) with 1 to 4 huge words (size 0.12 to 0.2) in Anton or Poppins 800, uppercase, wordsPop, pop or zoom. Alternate strong backgrounds, whip and flash transitions, crashZoom cameras on the words. Quick photo scenes between. Look: vivid, grain 0.2." }),
  T({ id: "hypermotion", category: "motion", name: "Hypermotion", blurb: "Fast, glossy and dynamic, like Higgsfield's Hypermotion.", seconds: 12,
    direction: "Hyper-dynamic product motion. Every scene has a strong camera (crashZoom, orbitLeft/Right intensity 0.8, dutchRoll), whip and blurZoom transitions, the product rotating 10 to 20 degrees with ease back, speed lines (line shapes drawn in fast, depth 0.9). Glossy gradients from the brand colours. Look: vivid, glow 0.45, vignette 0.3." }),
  T({ id: "dark-minimal", category: "motion", name: "Dark minimal", blurb: "Black background, elegant serif, slow and luxurious.", seconds: 15,
    direction: "Luxury minimalism. Near-black backgrounds, one thin accent colour (gold, cream or brand). Playfair or DM Serif headlines, Inter for small lines. blurIn and fade, long scenes (3 to 5 s), slow dollyIn intensity 0.3 with focus pulls, rounded photos with shadows. Never more than 6 words on screen. Look: film grade, glow 0.3, vignette 0.5, letterbox on wide shapes." }),
  T({ id: "colour-pop", category: "motion", name: "Colour pop", blurb: "Bright colour blocks, bouncy stickers and a price burst.", seconds: 12,
    direction: "Playful and loud. Bright saturated backgrounds changing every scene, blobs and bursts as stickers behind the product, bouncy keyframes (back, bounce, elastic), wordsPop text with a highlighted key word, a burst behind any price. Poppins or Nunito 800. Camera handheld shake 0.2 or panLeft. Look: vivid." }),
  T({ id: "typography-poster", category: "motion", name: "Typography poster", blurb: "Big graphic type layouts, like an animated poster.", seconds: 10,
    direction: "Swiss-poster typography. Large text blocks aligned left, grids of thin lines (line shapes), numbers as huge graphic elements, two colours only. Text animates with typewriter or words, lines draw in. Camera tiltDown slow. Look: none or faded, grain 0.2." }),
  // ---- 3D motion (the canvas "3D look": key light, fog, extruded text, turntables, particles, glass and metal)
  T({ id: "3d-title-drop", category: "3d", name: "3D title drop", blurb: "Huge extruded 3D words spin in under a studio light, sparkles all around.", seconds: 12, hook: "bold-claim",
    direction: "3D motion graphics. Every scene has a key light (x 0.15 to 0.3, y 0 to 0.1, intensity 0.8) and dark gradient backgrounds from the brand colours with fog 0.3 (fogColor a deep shade of the background). The hook is 1 to 3 huge words (Anton or Poppins 800, size 0.13 to 0.18, uppercase, depth 0.9) with text3d { depth 0.8, bevel true, spin true } and a side colour darker than the brand colour; camera orbitLeft or orbitRight intensity 0.7 so the 3D sides turn with the camera. Sparkles particles in front (depth 0.9, count 20) and bokeh far behind (depth 0.15, count 14). Then the product photo on a turntable (fit contain), one benefit per scene in text3d with less depth (0.4), and the price (only if given) in text3d with material metal. Look: glow 0.35, vignette 0.4." }),
  T({ id: "showroom-turntable", category: "3d", name: "Showroom turntable", blurb: "The product turns on a glossy studio floor with a moving shine.", seconds: 12,
    direction: "Premium showroom. Dark studio gradient backgrounds (charcoal to near-black, or a deep brand colour), a key light from the top right (x 0.8, y 0.05, intensity 0.9). The product photo large in the middle (w 0.6 to 0.7, h 0.5, fit contain, depth 0.6) with turntable { spin 1, angle 35, reflection 0.45 } (it draws its own lit floor and reflection), dust particles drifting (count 40, depth 0.7). Headlines above the turntable's box (y 0.12 to 0.18, never overlapping it) and one feature per scene in a glass box (box material glass) below it (y 0.8). Vary the shots: the turntable in two or three scenes (different sizes and swing), the others a close crop of a detail (cover, zoomTo 1.3, focusX/focusY on it) or the product in a rounded frame with a glass card above or below it (never over the frame); the end card has no turntable. Camera dollyIn intensity 0.3 or orbitRight 0.4. The end card shows the business name in 3D (text3d depth 0.5, bevel true). Look: glow 0.3, vignette 0.45, grain 0.1." }),
  T({ id: "glass-cards", category: "3d", name: "Glass cards", blurb: "Frosted glass cards with the benefits float in 3D over a glowing gradient.", seconds: 12,
    direction: "Glassmorphism in 3D. Rich gradient backgrounds from the brand colours, large bokeh particles behind (count 14 to 20, depth 0.1 to 0.2) and a key light with fog 0.2. Each benefit sits on a glass card (a rect shape with material glass and radius 0.12, the text on top) floating at its own depth (0.5 to 0.9) with gentle rotate keyframes (-4 to 4 degrees) so the camera's orbitLeft or orbitRight parallax separates the cards. Big numbers or one-word labels in text3d. The product photo rounded with shadow (the light places its highlight and shadow). Look: vivid, glow 0.3." }),
  T({ id: "chrome-luxe", category: "3d", name: "Chrome luxury", blurb: "Gold and chrome 3D lettering, slow light sweeps and drifting dust.", seconds: 15,
    direction: "Luxury 3D. Near-black backgrounds with fog 0.35 (fogColor a deep brand shade), a warm key light (color #fff4dc, intensity 0.9). Headlines in Playfair or Anton with text3d { material metal, depth 0.6, bevel true } in gold (#d4a017) or chrome (#c0c6cf); thin metal accents only (a ring, or rect bars h 0.006 to 0.01 above and below a headline), never a metal panel. Photo backgrounds dimmed 0.5 to 0.6 under gold text. The product on a slow turntable (spin 0.6, angle 25, reflection 0.5) on a dark gradient, its headline above its box. Warm white dust particles, slow (speed 0.5). Camera slow dollyIn 0.3 and orbit 0.3; fade and dip transitions. Never more than 6 words on screen. Look: film grade, glow 0.35, vignette 0.5, letterbox on wide shapes." }),
  T({ id: "confetti-launch", category: "3d", name: "Launch party", blurb: "A new product reveal with confetti, a 3D price and a big turntable spin.", seconds: 12, hook: "price-reveal",
    direction: "Launch celebration in 3D. Bright gradient backgrounds and a key light. The reveal scene: the product on a turntable (spin 1.5, angle 40) with confetti particles falling in front (depth 0.9, count 50) and sparkles behind; 'New' or the hook in text3d with spin true; the price (only if given) in text3d with material metal on a burst shape with material metal; flash and spin transitions; camera crashZoom on the reveal, then orbitRight. End with how to order in a glass box. Look: vivid, glow 0.35." }),
  T({ id: "floating-product-reveal", category: "3d", name: "Floating product reveal", blurb: "Three beats: a lit macro detail, the product floating among particles, a clean brand card.", seconds: 12,
    direction: "Three-beat reveal (docs/research/reels/tiktok-patterns.md A2, rules 1 to 3: the best 3D ads float the product with particles and end on a clean brand card). Beat 1 (0 to 2 s): a macro detail of the product (cover, zoomTo 1.35, focusX/focusY on a detail) on a near-black background, a strong rim light from behind and to the side (light x 0.85, y 0.1, intensity 1), vignette, dollyIn. Beat 2 (2 to about 8 s, one or two scenes): the product floating in the middle (fit contain, cutout true when its photo is marked cut-out available, depth 0.6, keyframes drifting dy -0.02 to 0.02 and rotate -5 to 5 with inOut), 4 to 8 floating accents around it (bubbles or sparkles particles, count 10 to 20, and 2 or 3 blob shapes as splashes behind the product only, in the theme colour; captions sit below the product in a box, never on a blob; without a cut-out the product is a rounded photo with shadow), one giant word behind the product (the product or flavour word, size 0.3 to 0.4, depth 0.2, w up to 1.5, cut by the frame edge, text3d depth 0.4), a simple one-colour background whose colour changes with each beat; slow orbitLeft or pushPull. Beat 3 (last 2 to 3 s): a clean card on a plain background, the business name huge in uppercase (text3d with bevel, or flat), the price only if given, and how to order; camera static. Look: glow 0.35, vignette 0.35." }),
  // ---- UGC
  T({ id: "ugc-review", category: "ugc", name: "Customer review", blurb: "A customer's words on screen like a phone video review.", seconds: 15, presenter: true,
    direction: "UGC-style review, as if filmed on a phone. Full-screen product photos with handheld camera (shake 0.4) and slight dutchRoll, captions in the TikTok style (white text with black box, words animation, lower third), a 5-star row (5 small burst or circle shapes in gold) and a short first-person review from the product's selling points. No invented customer names or quotes beyond the facts; write it as 'what customers love'." }),
  T({ id: "ugc-unboxing", category: "ugc", name: "Unboxing", blurb: "The reveal: box, open, wow, the product.", seconds: 15, hook: "pov", presenter: true,
    direction: "Unboxing reveal. Scene 1: a closed 'box' (rect shapes in kraft brown with a ribbon line) with 'Unboxing time' text, handheld camera. Scene 2: the box lid flies up (keyframes) and the product photo pops out (scale 0 to 1, ease back) with a flash transition. Then detail scenes with captions, and an outro. Look: warm, grain 0.2." }),
  T({ id: "ugc-pov", category: "ugc", name: "POV moment", blurb: "'POV:' a relatable everyday moment, then the product saves the day.", seconds: 12, hook: "pov", presenter: true,
    direction: "POV storytelling. Open with 'POV:' and a relatable everyday moment of the customer in big caption text over a softly blurred photo, handheld camera. Then the product as the answer, with crashZoom. Keep captions TikTok-style (white on black box). Look: none, grain 0.15." }),
  T({ id: "ugc-before-after", category: "ugc", name: "Problem → fix", blurb: "The everyday problem, then the product as the fix (no body before/after).", seconds: 12, hook: "before-after",
    direction: "Problem then solution. First half: dull grey or desaturated scene, the problem in text, slow camera. Hard flash cut to bright, saturated scenes with the product and the benefit, energetic camera. Never show bodies, health or medical before-and-after. Look: the first scenes faded, the rest vivid (use the background colours to show the change)." }),
  // ---- TikTok
  T({ id: "tiktok-gadget", category: "tiktok", name: "This saved me", blurb: "'This [product] saved me...' trend format.", seconds: 12, hook: "bold-claim",
    direction: "TikTok trend format 'This saved me'. Big caption hook at the top third, white text with black outline box, words animation. Fast cuts every 1.5 to 2 s, crashZoom and whip transitions, handheld shake 0.3. Ends with 'Link / WhatsApp' style call to action. Look: vivid." }),
  T({ id: "tiktok-3-reasons", category: "tiktok", name: "3 reasons", blurb: "A numbered list of benefits that tick in one by one.", seconds: 15, hook: "countdown",
    direction: "List video. Hook scene with the promise, then one scene per benefit (3 at most): a huge number in the accent colour with a ring shape drawing around it, the benefit in 3 to 7 words, the product photo beside it, same layout each time. Camera panLeft on each benefit. End with product and call to action. Look: none, vignette 0.2." }),
  T({ id: "tiktok-secret", category: "tiktok", name: "Secret hack", blurb: "'Nobody talks about this...' reveal format.", seconds: 10, hook: "question",
    direction: "Secret reveal. Dark first scene with 'Nobody tells you this' style hook in typewriter, focus pull, then a blurZoom reveal of the product with glow. Short punchy captions. Look: night grade then vivid, glow 0.3." }),
  // ---- Ads
  T({ id: "offer-flash", category: "ads", name: "Offer flash", blurb: "A sale or offer, loud and clear, ending with how to buy.", seconds: 12, hook: "price-reveal",
    direction: "Promotion ad. Hook with the offer itself in huge text (only offers, prices and dates present in the facts). Product, then 2 to 3 short reasons to buy now, then the price in a burst and how to order (phone, WhatsApp, location if given). Fast cuts, slideUp and whip, crashZoom on the price. Look: vivid." }),
  T({ id: "kigali-price-first", category: "ads", name: "Kigali price-first", blurb: "Price and phone bar on screen from second 0, an offer badge, the shop behind, how to order.", seconds: 15, hook: "price-reveal",
    direction: "Direct-response ad as Rwandan shops run them (docs/research/reels/tiktok-patterns.md A, rules 1, 5 and 6; facebook-patterns.md rules 1, 2 and 7: 11 of 17 Rwandan ads show the price, offer or phone number in the first 3 seconds, and a phone or WhatsApp bar from the first frame to the last is the commonest Facebook pattern in Rwanda). Every scene repeats the same phone bar at the same place from from 0 to to 1 with animate none: a solid green (#25D366) or yellow (#ffd200) rect shape (x 0.5, y 0.72, w 0.86, h 0.065, radius 0.5) with the phone or WhatsApp number in big dark digits on it (only when a phone is given; otherwise the website or 'Order on WhatsApp'). Scene 1 (0 to 3 s): the price large in the top third in a solid box (only if a price is given; otherwise the main offer from the facts) and an offer badge (a burst shape with 1 to 3 words from the facts) in frame 1, over the shop or product photo dimmed 0.45 (prefer a photo of the real shop, shelves or counter: a real place, not a studio). Scenes 2 to 4 (2 to 4 s each): the product in use or from different angles, a small label per shot (spec words or a benefit), handheld camera shake 0.2. Last scene: the ordering route named in words in the middle of the frame, never the bottom 15% ('Order on WhatsApp', 'Call', 'Visit us at' with the area), a trust line from the facts if any (MoMo, delivery). Flat bold text with shadow, no 3D. Look: vivid, grain 0.1." }),
  T({ id: "tv-spot", category: "ads", name: "TV spot", blurb: "A polished 'TV commercial' with cinematic moves and a tagline.", seconds: 20,
    direction: "Broadcast-quality commercial. 16:9 feel even in vertical: letterbox, full-bleed photos with slow dolly and orbit, elegant lower-third titles, a tagline scene in serif, an end card with logo-style business name, price and contact. Dip and fade transitions. Look: tealOrange or film, glow 0.25, vignette 0.35, letterbox true." }),
  T({ id: "brand-story", category: "ads", name: "Brand story", blurb: "Who you are, what you make, why people love you.", seconds: 20,
    direction: "Brand film. Calm pace, 4 to 6 scenes: who the business is (from its description), what it makes, how it helps customers, where to find it. Photos full-bleed with slow cameras (dollyIn, craneUp), captions with rise animation. Look: warm or film, grain 0.2, light leaks 0.3." }),
  // ---- Posters & offers
  T({ id: "event-poster", category: "promo", name: "Event poster", blurb: "An animated event or launch poster: date, place, CTA.", seconds: 10,
    direction: "Animated poster. One strong composition built up over the video: title, big date and place (only if in the facts), product photo cut into a shape, bursts and lines. Each element animates in staggered; camera slow dollyIn on the whole poster. Look: vivid, grain 0.2." }),
  T({ id: "price-drop", category: "promo", name: "Price drop", blurb: "Big price, big badge, countdown energy.", seconds: 8, hook: "price-reveal",
    direction: "Price-led promo. The price huge in Anton inside a spinning burst, the product beside it, 'Limited stock' style urgency only if true in the facts. Flash and whip transitions, crashZoom, handheld shake 0.3. Look: vivid." }),
  // ---- Marketplace
  T({ id: "marketplace-listing", category: "marketplace", name: "Listing video", blurb: "Clean e-commerce listing: product, features, price, delivery.", seconds: 12,
    direction: "Marketplace listing. White or very light backgrounds, product with fit contain and a soft floor shadow, feature chips (text with rounded boxes) appearing one by one, price and delivery or payment info (only from the facts). Calm camera orbit. Look: none." }),
  T({ id: "colour-options", category: "marketplace", name: "Colour options", blurb: "Show every colour or variant one after another.", seconds: 10,
    direction: "Variants showcase. One scene per colour or variant named in the facts, the background changing to match each colour, the product photo with a quick spin transition, the variant name in a pill box. Camera dollyIn. Look: vivid." }),
  // ---- Cinematic
  T({ id: "story-cinematic", category: "cinematic", name: "Cinematic story", blurb: "Full-screen photos with real camera moves and calm captions.", seconds: 15,
    direction: "Cinematic slideshow done like film. Full-bleed photo backgrounds (dim 0.2 to 0.35), every scene a different camera (dollyIn, panLeft, craneUp, orbitRight, pushPull), focus pulls, captions in the lower third (Inter 600 or Playfair) with rise, short sentences telling a small story. Dip and fade transitions. Look: tealOrange, glow 0.2, vignette 0.4, light leaks 0.3, grain 0.2, letterbox true." }),
  T({ id: "golden-hour", category: "cinematic", name: "Golden hour", blurb: "Warm sunset light, slow and emotional.", seconds: 15,
    direction: "Golden hour mood. Warm grade, strong light leaks (0.6) drifting, slow craneUp and dollyIn, soft serif captions with blurIn, long dissolves (fade, dip). Look: warm, glow 0.4, vignette 0.4, grain 0.2." }),
  T({ id: "kigali-market", category: "cinematic", name: "Local market", blurb: "Warm earthy colours and a friendly local feel.", seconds: 15,
    direction: "Warm and local. Earthy palette (terracotta, ochre, deep green, cream) unless the brand says otherwise, textured backgrounds (dots or lines), rounded photo frames, friendly Nunito text, handheld camera shake 0.25. Speak like a neighbour recommending a good shop. A greeting in the business's language may open the video (for Kinyarwanda: Muraho!). End with where to find the business. Look: warm, grain 0.25, light leaks 0.25." }),
];

export const templateById = (id: string): VideoTemplate => VIDEO_TEMPLATES.find((t) => t.id === id) ?? VIDEO_TEMPLATES[0];
