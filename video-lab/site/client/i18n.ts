// Language switcher EN / FR / RW (like seedance2ai's). English lives in the pages themselves; elements marked
// data-i18n="key" (text, may hold simple markup) or data-i18n-ph="key" (placeholder) take French or Kinyarwanda from
// this dictionary. The choice is kept in localStorage. Only the static page text is translated; messages from the
// studio (errors, progress) stay in English for now.
export type Lang = "en" | "fr" | "rw";
export const LANGS: Lang[] = ["en", "fr", "rw"];
const KEY = "studio.lang";

type Entry = { fr: string; rw: string };

export const T: Record<string, Entry> = {
  // Nav and footer
  "mode.subscription": { fr: "Mode test : les vidéos sont conçues avec l'abonnement Claude. Passez à la clé API (ANTHROPIC_API_KEY) avant tout déploiement ou usage client.", rw: "Uburyo bw'igerageza: video zikorwa hakoreshejwe ifatabuguzi rya Claude. Koresha urufunguzo rwa API (ANTHROPIC_API_KEY) mbere yo kuyishyira ahagaragara cyangwa kuyiha abakiriya." },
  "nav.video": { fr: "Vidéo IA", rw: "Video za AI" },
  "nav.pro": { fr: "Meilleure qualité, vraie vidéo", rw: "Ubwiza buhanitse, video nyayo" },
  "nav.fast": { fr: "Plus rapide et moins chère", rw: "Yihuta kandi ihendutse" },
  "nav.mini": { fr: "Le meilleur prix", rw: "Igiciro gito" },
  "nav.next": { fr: "Le prochain modèle", rw: "Uburyo bushya buraza" },
  "nav.motion": { fr: "Vidéos animées instantanées", rw: "Video za 3D zihuse" },
  "nav.image": { fr: "Image IA", rw: "Amafoto ya AI" },
  "nav.templates": { fr: "Modèles", rw: "Inyandikorugero" },
  "nav.showcase": { fr: "Galerie", rw: "Ingero" },
  "nav.pricing": { fr: "Tarifs", rw: "Ibiciro" },
  "nav.guide": { fr: "Guide", rw: "Amabwiriza" },
  "nav.viral": { fr: "Bibliothèque virale", rw: "Ububiko bw'ibyamamaye" },
  "viral.kicker": { fr: "Bibliothèque virale", rw: "Ububiko bw'ibyamamaye" },
  "viral.h1": { fr: "Ce qui est devenu <span class=\"grad\">viral</span>, et pourquoi", rw: "Ibyamamaye <span class=\"grad\">cyane</span>, n'impamvu" },
  "viral.ads": { fr: "Publicités seulement", rw: "Amatangazo gusa" },
  "viral.search": { fr: "Chercher une légende, un compte ou un hashtag", rw: "Shakisha ibisobanuro, konti cyangwa hashtag" },
  "viral.empty": { fr: "L'équipe de recherche collecte des vidéos virales ; cette page se remplit au fil de son travail.", rw: "Itsinda ry'ubushakashatsi riragenda rikusanya video zamamaye; uru rupapuro rugenda rwuzura uko rikora." },
  "viral.none": { fr: "Aucune vidéo ne correspond à ces filtres.", rw: "Nta video ihuye n'ayo mashungura." },
  "viral.close": { fr: "Fermer", rw: "Funga" },
  "viral.all": { fr: "Tout", rw: "Byose" },
  "viral.p.tiktok": { fr: "TikTok", rw: "TikTok" },
  "viral.p.instagram": { fr: "Instagram", rw: "Instagram" },
  "viral.p.facebook": { fr: "Facebook", rw: "Facebook" },
  "viral.p.youtube": { fr: "YouTube Shorts", rw: "YouTube Shorts" },
  "viral.r.all": { fr: "Toutes les régions", rw: "Uturere twose" },
  "viral.r.east": { fr: "Afrique de l'Est", rw: "Afurika y'Iburasirazuba" },
  "viral.r.rw": { fr: "Rwanda seulement", rw: "U Rwanda gusa" },
  "viral.r.global": { fr: "Monde", rw: "Isi yose" },
  "viral.f.sector": { fr: "Tous les secteurs", rw: "Ibyiciro byose" },
  "viral.f.format": { fr: "Tous les formats", rw: "Imiterere yose" },
  "viral.f.hook": { fr: "Tous les types d'accroche", rw: "Ubwoko bwose bw'intangiriro" },
  "viral.s.views": { fr: "Trier : vues", rw: "Tondeka: abarebye" },
  "viral.s.ratio": { fr: "Trier : ratio viral", rw: "Tondeka: igipimo cy'ubwamamare" },
  "viral.s.likes": { fr: "Trier : j'aime", rw: "Tondeka: ibyakunzwe" },
  "viral.s.new": { fr: "Trier : plus récentes", rw: "Tondeka: bishya" },
  "viral.views": { fr: "vues", rw: "abarebye" },
  "viral.followers": { fr: "abonnés", rw: "abakurikira" },
  "viral.likes": { fr: "j'aime", rw: "ibyakunzwe" },
  "viral.comments": { fr: "commentaires", rw: "ibitekerezo" },
  "viral.shares": { fr: "partages", rw: "ibyasangijwe" },
  "viral.saves": { fr: "enregistrements", rw: "ibyabitswe" },
  "viral.play": { fr: "Lire sur", rw: "Reba kuri" },
  "viral.openon": { fr: "Ouvrir sur", rw: "Fungura kuri" },
  "viral.copy": { fr: "Copier", rw: "Koporora" },
  "viral.copied": { fr: "Copié", rw: "Byakoporowe" },
  "viral.caption": { fr: "Légende (telle quelle)", rw: "Ibisobanuro (uko biri)" },
  "viral.hashtags": { fr: "Hashtags", rw: "Hashtags" },
  "viral.sound": { fr: "Son", rw: "Amajwi" },
  "viral.breakdown": { fr: "Analyse", rw: "Isesengura" },
  "viral.first3": { fr: "Les 3 premières secondes", rw: "Amasegonda 3 ya mbere" },
  "viral.structure": { fr: "Structure", rw: "Imiterere" },
  "viral.cuts": { fr: "Coupes par 10 s", rw: "Ibicibwa mu masegonda 10" },
  "viral.textstyle": { fr: "Style du texte", rw: "Imiterere y'inyandiko" },
  "viral.voice": { fr: "Voix", rw: "Ijwi" },
  "viral.cta": { fr: "Appel à l'action", rw: "Gutumira gukora" },
  "viral.why": { fr: "Pourquoi c'est devenu viral", rw: "Impamvu byamamaye" },
  "viral.lesson": { fr: "Leçon pour BuPulse", rw: "Isomo kuri BuPulse" },
  "viral.comm": { fr: "Meilleurs commentaires", rw: "Ibitekerezo byiza" },
  "viral.make": { fr: "Faire une vidéo comme celle-ci", rw: "Kora video imeze nk'iyi" },
  "viral.shown": { fr: "vidéos affichées", rw: "video zigaragara" },
  "viral.totals": { fr: "vidéos virales de TikTok, Instagram, Facebook et YouTube Shorts", rw: "video zamamaye zo kuri TikTok, Instagram, Facebook na YouTube Shorts" },
  "viral.newest": { fr: "Dernière collecte :", rw: "Ikusanyamakuru rya nyuma:" },
  "viral.noframes": { fr: "Pas d'image", rw: "Nta shusho" },
  "look.label": { fr: "Ambiance :", rw: "Isura:" },
  "look.studio": { fr: "Showroom sombre", rw: "Icyumba cyijimye cyo kwerekaniramo" },
  "look.daylight": { fr: "Studio en lumière du jour", rw: "Studio y'urumuri rw'umunsi" },
  "look.neon": { fr: "Néon", rw: "Amatara ya neon" },
  "nav.home": { fr: "Accueil", rw: "Ahabanza" },
  "nav.start": { fr: "Commencer", rw: "Tangira gukora" },
  "foot.video": { fr: "Vidéo IA", rw: "Video za AI" },
  "foot.create": { fr: "Créer", rw: "Kora" },
  "foot.influencers": { fr: "Influenceurs IA", rw: "Abamamaza ba AI" },
  "foot.myvideos": { fr: "Mes vidéos", rw: "Video zanjye" },
  "foot.help": { fr: "Aide", rw: "Ubufasha" },
  "foot.pricing": { fr: "Tarifs et crédits", rw: "Ibiciro na credits" },
  "foot.api": { fr: "API pour développeurs", rw: "API y'abakora porogaramu" },
  "foot.lab": { fr: "Labo développeur", rw: "Aho abakora porogaramu bagerageza" },
  "foot.about": { fr: "Marketing IA pour les entreprises au Rwanda et en Afrique de l'Est. Video Studio est en test : base de données de TEST uniquement, aucun client ne le voit.", rw: "Kwamamaza hakoreshejwe AI ku bucuruzi bwo mu Rwanda no muri Afurika y'Iburasirazuba. Video Studio iracyageragezwa: nta mukiriya uyibona." },
  "foot.legal": { fr: "© 2026 BuPulse. Seedance est un modèle de ByteDance, utilisé via BytePlus ModelArk ; Claude est d'Anthropic ; Nano Banana est le modèle d'images Gemini de Google. BuPulse n'est pas affilié à eux.", rw: "© 2026 BuPulse. Seedance ni iya ByteDance, ikoreshwa binyuze kuri BytePlus ModelArk; Claude ni iya Anthropic; Nano Banana ni iya Google (Gemini). BuPulse ntaho ihuriye na bo." },

  // Generator pages
  "create.pill": { fr: "BuPulse Video Studio", rw: "BuPulse Video Studio" },
  "create.h1a": { fr: "Transformez chaque produit", rw: "Hindura igicuruzwa cyose" },
  "create.h1b": { fr: "en vidéo prête à publier", rw: "video yiteguye gushyirwa ku mbuga" },
  "model.seedance-2-0.tagline": { fr: "Vraie vidéo IA, contrôle précis des références", rw: "Video nyayo ya AI, ikurikiza neza amafoto yawe" },
  "model.seedance-2-0.blurb": { fr: "La meilleure qualité : de vraies personnes, produits et lieux en mouvement, avec le son, jusqu'en 1080p.", rw: "Ubwiza buhanitse: abantu, ibicuruzwa n'ahantu bigenda koko, n'amajwi, kugeza kuri 1080p." },
  "model.seedance-2-0-fast.tagline": { fr: "Vraie vidéo IA, plus rapide et moins chère", rw: "Video nyayo ya AI, yihuta kandi ihendutse" },
  "model.seedance-2-0-fast.blurb": { fr: "Seedance 2.0 moins cher et plus rapide : le choix de tous les jours pour les réseaux sociaux.", rw: "Seedance 2.0 ku giciro gito kandi yihuta: ihitamo rya buri munsi ku mbuga nkoranyambaga." },
  "model.seedance-2-0-mini.tagline": { fr: "Vraie vidéo IA au meilleur prix", rw: "Video nyayo ya AI ku giciro cyiza" },
  "model.seedance-2-0-mini.blurb": { fr: "La vraie vidéo la moins chère : environ la moitié du prix de Seedance 2.0, idéale pour les brouillons et les scènes simples.", rw: "Video nyayo ihendutse kurusha izindi: hafi kimwe cya kabiri cy'igiciro cya Seedance 2.0. Nziza ku igerageza no ku mashusho yoroheje." },
  "model.seedance-2-5.tagline": { fr: "Le prochain modèle Seedance", rw: "Seedance nshya iraje" },
  "model.seedance-2-5.blurb": { fr: "Le prochain modèle vidéo de ByteDance. Il arrive dans le studio avec la clé BytePlus.", rw: "Uburyo bushya bwa ByteDance bwo gukora video. Buzaza muri studio hamwe n'urufunguzo rwa BytePlus." },
  "model.motion.tagline": { fr: "Vidéos animées 3D conçues par Claude", rw: "Video za 3D zishushanywa na Claude" },
  "model.motion.blurb": { fr: "Claude conçoit une vidéo animée en 3D à partir de vos photos : mouvements de caméra, texte 3D, musique, sous-titres et voix off, en une minute environ.", rw: "Claude ikora video ya 3D ivuye ku mafoto yawe: kamera igenda, inyandiko za 3D, umuziki, amagambo n'ijwi rivuga, mu munota umwe." },
  "model.nano-banana.tagline": { fr: "Images IA réalistes à partir de texte et de vos photos", rw: "Amafoto ya AI asa n'ay'ukuri, ava ku nyandiko n'amafoto yawe" },
  "model.nano-banana.blurb": { fr: "Le modèle d'images Gemini de Google : décrivez une image, ajoutez jusqu'à 3 photos, obtenez une image réaliste à publier ou à utiliser dans une vidéo.", rw: "Gemini ya Google: sobanura ifoto ushaka, ongeraho amafoto agera kuri 3, ubone ifoto isa n'iy'ukuri yo gushyira ku mbuga cyangwa muri video." },
  "soon.h3": { fr: "Il arrive avec la clé BytePlus", rw: "Izaza hamwe n'urufunguzo rwa BytePlus" },
  "soon.p1": { fr: "Seedance 2.5 est le prochain modèle vidéo de ByteDance. BuPulse accède à Seedance via BytePlus ModelArk ; dès que la clé BytePlus est ajoutée et que BytePlus ouvre la 2.5 à notre compte, cette page devient son générateur, avec la même barre de prompt, les mêmes références et crédits que Seedance 2.0.", rw: "Seedance 2.5 ni uburyo bushya bwa ByteDance. BuPulse ikoresha Seedance binyuze kuri BytePlus. Urufunguzo rwa BytePlus nirumara kongerwamo, iyi paji izahinduka aho uyikorera, nk'uko bimeze kuri Seedance 2.0." },
  "soon.p2": { fr: "En attendant : préparez votre vidéo avec Seedance 2.0 (elle attend aussi la clé), ou créez dès aujourd'hui une vidéo animée 3D avec Claude.", rw: "Hagati aho: tegura video yawe na Seedance 2.0, cyangwa ukore video ya 3D na Claude uyu munsi." },
  "soon.use20": { fr: "Utiliser Seedance 2.0", rw: "Koresha Seedance 2.0" },
  "soon.motion": { fr: "Créer une vidéo animée 3D maintenant", rw: "Kora video ya 3D nonaha" },

  // Home
  "home.chip": { fr: "Seedance 2.0 · Claude 3D motion · Nano Banana · Fait pour le Rwanda", rw: "Seedance 2.0 · Claude 3D · Nano Banana · Byakorewe u Rwanda" },
  "home.h1a": { fr: "De vraies vidéos pour votre entreprise,", rw: "Video nyazo z'ubucuruzi bwawe," },
  "home.h1b": { fr: "prêtes en quelques minutes", rw: "zikozwe mu minota mike" },
  "home.lead": { fr: "Transformez vos produits, photos et offres en vidéos prêtes à publier sur Instagram Reels, TikTok, YouTube Shorts et Facebook. De vraies personnes et de vrais lieux en mouvement avec Seedance 2.0, ou des vidéos animées 3D instantanées conçues par Claude.", rw: "Hindura ibicuruzwa byawe, amafoto n'ibyo ugurisha video ziteguye gushyirwa kuri Instagram, TikTok, YouTube na Facebook. Abantu n'ahantu bigenda koko na Seedance 2.0, cyangwa video za 3D zihuse zikozwe na Claude." },
  "home.quick.ph": { fr: "Décrivez la vidéo voulue : le produit, le lieu, la caméra…", rw: "Sobanura video ushaka: igicuruzwa, ahantu, kamera…" },
  "home.quick.real": { fr: "Créer une vraie vidéo", rw: "Kora video nyayo" },
  "home.quick.motion": { fr: "Créer une vidéo animée 3D", rw: "Kora video ya 3D" },
  "home.cta.showcase": { fr: "✨ Galerie", rw: "✨ Ingero" },
  "home.chip1": { fr: "Références texte, image, vidéo et audio", rw: "Inyandiko, amafoto, video n'amajwi" },
  "home.chip2": { fr: "4 à 15 secondes", rw: "Amasegonda 4 kugeza 15" },
  "home.chip3": { fr: "Son inclus", rw: "Ifite amajwi" },
  "home.chip4": { fr: "Sans filigrane", rw: "Nta kirango cy'abandi" },
  "home.chip5": { fr: "Payez en crédits RWF", rw: "Ishyura muri RWF" },
  "home.stat.models": { fr: "Modèles", rw: "Uburyo bukoreshwa" },
  "home.stat.inputs": { fr: "Entrées", rw: "Ibyo ushyiramo" },
  "home.stat.inputsV": { fr: "Texte · Image · Vidéo · Audio", rw: "Inyandiko · Ifoto · Video · Amajwi" },
  "home.stat.best": { fr: "Idéal pour", rw: "Ibyiza kuri" },
  "home.stat.bestV": { fr: "Boutiques · Restauration · Beauté · Immobilier", rw: "Amaduka · Ibiryo · Ubwiza · Inzu" },
  "home.made.kicker": { fr: "Fait avec BuPulse", rw: "Byakozwe na BuPulse" },
  "home.made.h2": { fr: "De vrais clips du studio", rw: "Video nyazo zakozwe muri studio" },
  "home.models.kicker": { fr: "Modèles", rw: "Uburyo" },
  "home.models.h2": { fr: "Choisissez un modèle et allez droit à son générateur", rw: "Hitamo uburyo, ujye aho ukorera video" },
  "home.models.video": { fr: "Vidéo IA", rw: "Video za AI" },
  "home.models.image": { fr: "Image IA", rw: "Amafoto ya AI" },
  "home.models.motion": { fr: "Animation 3D par Claude", rw: "Video za 3D za Claude" },
  "home.models.open": { fr: "Ouvrir le générateur →", rw: "Tangira gukora →" },
  "home.models.soon": { fr: "Bientôt : voir ce qu'il fera", rw: "Biraza vuba: reba icyo izakora" },
  "home.show.kicker": { fr: "Inspirez-vous", rw: "Reba ingero" },
  "home.show.h2": { fr: "Fait dans le studio", rw: "Byakorewe muri studio" },
  "home.show.p": { fr: "Des vidéos faites ici, à partir des produits des entreprises de test. Cliquez pour regarder.", rw: "Video zakorewe hano, ku bicuruzwa by'ubucuruzi bw'igerageza. Kanda kuri imwe uyirebe." },
  "home.show.all": { fr: "Voir toute la galerie →", rw: "Reba ingero zose →" },
  "home.how.kicker": { fr: "Comment créer", rw: "Uko wakora video" },
  "home.how.h2": { fr: "Votre vidéo en trois étapes", rw: "Video yawe mu ntambwe eshatu" },
  "home.how.s1": { fr: "Choisissez un produit ou une photo", rw: "Hitamo igicuruzwa cyangwa ifoto" },
  "home.how.p1": { fr: "Vos produits, photos et prix sont déjà dans BuPulse. Appuyez sur PRODUCT, ou ajoutez vos photos, vidéos et sons.", rw: "Ibicuruzwa byawe, amafoto n'ibiciro bisanzwe biri muri BuPulse. Kanda PRODUCT, cyangwa wongereho amafoto yawe, video n'amajwi." },
  "home.how.s2": { fr: "Décrivez-la et choisissez les réglages", rw: "Yisobanure, uhitemo uko izaba imeze" },
  "home.how.p2": { fr: "Écrivez une phrase ou laissez Claude écrire le découpage. Choisissez le format, la durée et la qualité. Les crédits s'affichent avant de cliquer.", rw: "Andika interuro imwe cyangwa ureke Claude ayandike. Hitamo ishusho, igihe n'ubwiza. Ubona credits mbere yo gukanda." },
  "home.how.s3": { fr: "Générez, modifiez et publiez", rw: "Kora, uhindure, ushyire ku mbuga" },
  "home.how.p3": { fr: "Regardez-la, modifiez-la en décrivant le changement, prolongez-la, téléchargez le MP4 ou programmez-la dans BuPulse.", rw: "Yirebe, uyihindure usobanura icyo ushaka, uyongere, uyikuremo, cyangwa uyiteganye muri BuPulse." },
  "home.how.cta": { fr: "Commencer avec Seedance 2.0 Fast", rw: "Tangira na Seedance 2.0 Fast" },
  "home.how.guide": { fr: "Lire le guide", rw: "Soma amabwiriza" },
  "home.feat.kicker": { fr: "Fonctions clés", rw: "Ibyo ishoboye" },
  "home.feat.h2": { fr: "Tout ce qu'il faut à une petite entreprise pour publier des vidéos chaque semaine", rw: "Ibyo ubucuruzi buto bukeneye kugira ngo bushyire video ku mbuga buri cyumweru" },
  "home.f1": { fr: "Référencez tout", rw: "Koresha ifoto iyo ari yo yose" },
  "home.f1p": { fr: "Jusqu'à 9 photos, 3 vidéos et 3 sons. Votre vrai produit reste reconnaissable : même forme, mêmes couleurs, mêmes étiquettes.", rw: "Amafoto agera kuri 9, video 3 n'amajwi 3. Igicuruzwa cyawe kiguma uko kiri: ishusho, amabara n'ibirango bimwe." },
  "home.f2": { fr: "Des personnes réalistes, en sécurité", rw: "Abantu basa n'ab'ukuri, nta kibazo" },
  "home.f2p": { fr: "Les présentateurs sont fictifs : présentateurs IA et bibliothèque de personnages BytePlus. Les visages de vrais clients ne sont jamais envoyés au modèle.", rw: "Abamamaza ni abahimbano: aba AI n'abo muri BytePlus. Amasura y'abakiriya nyabo ntiyoherezwa." },
  "home.f3": { fr: "Une caméra que vous dirigez", rw: "Kamera uyobora" },
  "home.f3p": { fr: "Travelling, orbite, grue, zoom rapide, caméra à l'épaule, plan fixe. Claude peut écrire le découpage à partir de votre produit.", rw: "Kamera yegera, izenguruka, izamuka, yihuta cyangwa ihagaze. Claude ashobora kwandika uko amashusho akurikirana." },
  "home.f4": { fr: "Modifier et prolonger", rw: "Hindura kandi wongere" },
  "home.f4p": { fr: "Modifiez une vidéo finie en décrivant le changement, ou ajoutez-lui des secondes. Gardez ce qui marche, corrigez le reste.", rw: "Hindura video irangiye usobanura icyo ushaka, cyangwa uyongereho amasegonda." },
  "home.f5": { fr: "Son et sous-titres", rw: "Amajwi n'amagambo yanditse" },
  "home.f5p": { fr: "Les clips ont un son généré. Les vidéos animées ont musique, voix off et sous-titres en anglais, français ou kinyarwanda.", rw: "Video zigira amajwi. Video za 3D zigira umuziki, ijwi n'amagambo mu Cyongereza, Igifaransa cyangwa Ikinyarwanda." },
  "home.f6": { fr: "Prêt à publier", rw: "Yiteguye gushyirwa ku mbuga" },
  "home.f6p": { fr: "Le bon format pour chaque réseau, une légende et des hashtags, et un clic pour programmer dans BuPulse.", rw: "Ishusho ikwiriye buri rubuga, ibisobanuro na hashtags, no gukanda rimwe ngo uyiteganye muri BuPulse." },
  "home.uses.kicker": { fr: "Possibilités infinies", rw: "Byinshi bishoboka" },
  "home.uses.h2": { fr: "Pour chaque entreprise, à Kigali et au-delà", rw: "Kuri buri bucuruzi, i Kigali n'ahandi" },
  "home.u1": { fr: "Boutiques et e-commerce", rw: "Amaduka n'ubucuruzi kuri internet" },
  "home.u1p": { fr: "Présentations de produits, nouveautés, déballages, baisses de prix.", rw: "Kwerekana ibicuruzwa, ibishya, gufungura amapaki, kugabanya ibiciro." },
  "home.u2": { fr: "Restauration et boissons", rw: "Ibiryo n'ibinyobwa" },
  "home.u2p": { fr: "Plats qui grésillent, jus frais, promos de livraison.", rw: "Ibiryo bishyushye, imitobe mishya, kugeza ku muryango." },
  "home.u3": { fr: "Beauté et mode", rw: "Ubwiza n'imideli" },
  "home.u3p": { fr: "Essayages, transformations au salon, gros plans produits.", rw: "Kugerageza imyenda, impinduka muri salon, ibicuruzwa birebwa hafi." },
  "home.u4": { fr: "Immobilier", rw: "Inzu n'ubutaka" },
  "home.u4p": { fr: "Visites vidéo de biens à partir de photos.", rw: "Gusura inzu muri video, uhereye ku mafoto." },
  "home.u5": { fr: "Services", rw: "Serivisi" },
  "home.u5p": { fr: "Explications, histoires, avant et après.", rw: "Ibisobanuro, inkuru, mbere na nyuma." },
  "home.u6": { fr: "Événements", rw: "Ibirori" },
  "home.u6p": { fr: "Affiches animées avec date, lieu et appel à l'action.", rw: "Amatangazo agenda afite itariki, aho bizabera n'icyo usaba." },
  "home.u7": { fr: "Tech et téléphones", rw: "Ikoranabuhanga na telefoni" },
  "home.u7p": { fr: "Caractéristiques qui ressortent, démos, comparaisons.", rw: "Ibiranga telefoni, kwerekana uko ikoreshwa, kugereranya." },
  "home.u8": { fr: "Éducation", rw: "Uburezi" },
  "home.u8p": { fr: "Promos de cours, astuces, listes de 3 raisons.", rw: "Kwamamaza amasomo, inama, impamvu 3." },
  "home.quotes.kicker": { fr: "Ce qu'en disent les commerçants", rw: "Icyo abacuruzi bavuga" },
  "home.quotes.h2": { fr: "Pensé pour les commerçants pressés", rw: "Byakorewe abacuruzi bahuze" },
  "home.quotes.note": { fr: "Citations d'exemple : le studio est encore en test, elles montrent le résultat visé. Elles ne viennent pas encore de vrais clients.", rw: "Izi ni ingero: studio iracyageragezwa. Ntabwo ari amagambo y'abakiriya nyabo." },
  "home.quotes.ex": { fr: "Exemple", rw: "Urugero" },
  "home.q1": { fr: "« J'ai pris une photo de mes nouveaux téléphones et j'avais un Reel prêt avant midi. »", rw: "\"Nafotoye telefoni nshya, mbona Reel mbere ya saa sita.\"" },
  "home.q1w": { fr: "Propriétaire d'une boutique de téléphones, Kigali", rw: "Nyiri iduka rya telefoni, Kigali" },
  "home.q2": { fr: "« La vidéo 3D de baisse de prix a apporté plus de messages WhatsApp que nos affiches. »", rw: "\"Video ya 3D igabanya ibiciro yatuzaniye ubutumwa bwinshi kuri WhatsApp kurusha amatangazo.\"" },
  "home.q2w": { fr: "Gérant de restaurant, Musanze", rw: "Umuyobozi wa resitora, Musanze" },
  "home.q3": { fr: "« Cinq photos de la maison sont devenues une vraie visite vidéo. »", rw: "\"Amafoto atanu y'inzu yabaye video yo kuyisura.\"" },
  "home.q3w": { fr: "Agent immobilier, Kibagabaga", rw: "Umukomisiyoneri w'inzu, Kibagabaga" },
  "home.price.kicker": { fr: "Tarifs", rw: "Ibiciro" },
  "home.price.h2": { fr: "Crédits en RWF, payez avec MoMo", rw: "Credits muri RWF, ishyura na MoMo" },
  "home.price.p": { fr: "Les crédits n'expirent pas pendant votre abonnement. Les vidéos ratées sont remboursées. Le prix s'affiche avant chaque génération.", rw: "Credits ntizirangira mu gihe ufite ifatabuguzi. Video itakozwe irasubizwa. Igiciro ukibona mbere yo gukora." },
  "home.faq.h2": { fr: "Questions", rw: "Ibibazo" },
  "home.faq1": { fr: "Qu'est-ce que Seedance 2.0 ?", rw: "Seedance 2.0 ni iki?" },
  "home.faq1a": { fr: "Le modèle vidéo de ByteDance. Il crée des vidéos réalistes à partir de texte, photos, vidéos et sons, avec le son. BuPulse l'utilise via BytePlus, le service cloud officiel de ByteDance.", rw: "Ni uburyo bwa ByteDance bukora video zisa n'iz'ukuri, buhereye ku nyandiko, amafoto, video n'amajwi. BuPulse ibukoresha binyuze kuri BytePlus." },
  "home.faq2": { fr: "Quelle différence entre une vraie vidéo et une vidéo animée ?", rw: "Video nyayo itandukaniye he na video ya 3D?" },
  "home.faq2a": { fr: "Une vraie vidéo est filmée par Seedance : les personnes et les objets bougent vraiment. Une vidéo animée est conçue par Claude à partir de vos photos : mouvements de caméra, texte 3D et graphismes. Elle est instantanée et coûte peu de crédits ; une vraie vidéo prend 1 à 10 minutes et coûte plus.", rw: "Video nyayo ikorwa na Seedance: abantu n'ibintu bigenda koko. Video ya 3D ikorwa na Claude ku mafoto yawe: kamera igenda, inyandiko za 3D n'amashusho. Yihuta kandi ihendutse; video nyayo imara iminota 1 kugeza 10 kandi ihenda kurushaho." },
  "home.faq3": { fr: "Puis-je montrer mon personnel ou moi-même ?", rw: "Nshobora kugaragaza abakozi banjye cyangwa njye ubwanjye?" },
  "home.faq3a": { fr: "Pas encore. Seedance n'accepte pas les photos de vrais visages. Les présentateurs sont fictifs : présentateurs IA ou bibliothèque de personnages BytePlus.", rw: "Ntabwo biraboneka. Seedance ntiyemera amafoto y'amasura y'abantu nyabo. Abamamaza ni abahimbano." },
  "home.faq4": { fr: "Quels formats et durées ?", rw: "Ni izihe shusho n'igihe bishoboka?" },
  "home.faq4a": { fr: "9:16, 3:4, 1:1, 4:3, 16:9 et 21:9 ; 4 à 15 secondes pour un clip Seedance, 4 à 30 secondes pour une vidéo animée.", rw: "9:16, 3:4, 1:1, 4:3, 16:9 na 21:9; amasegonda 4 kugeza 15 kuri Seedance, 4 kugeza 30 kuri video ya 3D." },
  "home.faq5": { fr: "Les vidéos sont-elles sans filigrane ?", rw: "Video ntizigira ikirango cy'abandi?" },
  "home.faq5a": { fr: "Oui.", rw: "Yego, ntazo." },
  "home.faq6": { fr: "Comment les crédits sont-ils comptés ?", rw: "Credits zibarwa gute?" },
  "home.faq6a": { fr: "Chaque vidéo affiche ses crédits avant la génération : selon la durée, la qualité et le moteur. Une génération ratée rend les crédits.", rw: "Buri video yerekana credits mbere yo gukorwa: bitewe n'igihe, ubwiza n'uburyo. Iyo bitakunze, credits zirasubizwa." },

  // Pricing
  "price.kicker": { fr: "Tarifs", rw: "Ibiciro" },
  "price.h1a": { fr: "Crédits en RWF,", rw: "Credits muri RWF," },
  "price.h1b": { fr: "payez avec MoMo", rw: "ishyura na MoMo" },
  "price.p": { fr: "Chaque vidéo affiche ses crédits avant la génération. Les vidéos ratées sont remboursées. Dans ce studio de test, « Buy » ajoute des crédits au portefeuille de test sans paiement.", rw: "Buri video yerekana credits mbere yo gukorwa. Video itakozwe irasubizwa. Muri iyi studio y'igerageza, \"Buy\" yongera credits nta kwishyura." },
  "price.h2": { fr: "Ce que coûte une vidéo", rw: "Igiciro cya video" },
  "price.p2": { fr: "Clips Seedance, par clip, selon la qualité et la résolution. 1 crédit = 10 RWF.", rw: "Video za Seedance, bitewe n'ubwiza n'ingano. Credit 1 = 10 RWF." },
  "price.motion": { fr: "Vidéos animées 3D par Claude :", rw: "Video za 3D za Claude:" },
  "price.each": { fr: "crédits chacune.", rw: "credits buri imwe." },
  "price.image": { fr: "Images IA (Nano Banana) et images de présentateurs réalistes :", rw: "Amafoto ya AI (Nano Banana) n'ay'abamamaza:" },
  "price.premium": { fr: "Clips Premium 3D (Blender) :", rw: "Video za Premium 3D (Blender):" },
  "price.voice": { fr: "Une voix off ajoute", rw: "Ijwi rivuga ryongeraho" },
  "price.credits": { fr: "crédits.", rw: "credits." },
  "price.note": { fr: "Les prix Seedance viennent des tarifs publiés par BytePlus et seront vérifiés sur la première facture.", rw: "Ibiciro bya Seedance biva ku biciro bya BytePlus, bizagenzurwa kuri fagitire ya mbere." },
  "price.wallet": { fr: "Votre portefeuille", rw: "Ikofi yawe" },

  // Guide
  "guide.h1a": { fr: "Comment créer des vidéos dans le", rw: "Uko wakora video muri" },
  "guide.h1b": { fr: "studio", rw: "studio" },
  "guide.h2a": { fr: "1. Trois façons de créer", rw: "1. Uburyo butatu bwo gukora" },
  "guide.p1": { fr: "<b>Seedance 2.0 (vraie vidéo)</b> crée des images réalistes : les gens bougent, des mains tiennent le produit, la caméra traverse un lieu, et le clip a du son. Cela prend 1 à 10 minutes et coûte le plus de crédits. <b>Claude 3D motion</b> conçoit une vidéo animée à partir de vos photos en une minute environ : mouvements de caméra, texte 3D, formes, musique et sous-titres. C'est instantané et peu cher. <b>Nano Banana</b> crée une image réaliste à partir d'un prompt et de 3 photos au plus. Seedance pour les personnes et l'action ; Motion pour les offres, les listes et les présentations de produits ; les images pour vos posts et comme première image d'une vidéo.", rw: "<b>Seedance 2.0 (video nyayo)</b> ikora amashusho asa n'ay'ukuri: abantu baragenda, intoki zifata igicuruzwa, kamera inyura ahantu, kandi video ifite amajwi. Imara iminota 1 kugeza 10, ni yo ihenda kurusha izindi. <b>Claude 3D motion</b> ikora video ya animation ku mafoto yawe mu munota umwe: kamera igenda, inyandiko za 3D, umuziki n'amagambo. Irihuta kandi irahendutse. <b>Nano Banana</b> ikora ifoto isa n'iy'ukuri. Koresha Seedance ku bantu n'ibikorwa; Motion ku biciro n'ibicuruzwa bishya; amafoto ku mbuga no gutangiza video." },
  "guide.h2b": { fr: "2. Créer une vidéo Seedance", rw: "2. Gukora video ya Seedance" },
  "guide.h2c": { fr: "3. Bien écrire un prompt Seedance", rw: "3. Kwandika neza ibyo ushaka kuri Seedance" },
  "guide.h2d": { fr: "4. Créer une vidéo animée 3D", rw: "4. Gukora video ya 3D" },
  "guide.p4": { fr: "Ouvrez Claude 3D motion. Choisissez un produit, jusqu'à 4 photos, un modèle, une accroche, le format et la durée. Ajoutez un présentateur dessin animé (gratuit) ou un présentateur IA réaliste. Appuyez sur Generate, regardez, modifiez ou prolongez en décrivant le changement, puis créez le MP4 en 480p, 720p ou 1080p.", rw: "Fungura Claude 3D motion. Hitamo igicuruzwa, amafoto agera kuri 4, inyandikorugero, intangiriro, ishusho n'igihe. Ongeramo umumamaza wa karato (ubuntu) cyangwa uwa AI. Kanda Generate, uyirebe, uyihindure, hanyuma ukore MP4." },
  "guide.h2e": { fr: "5. Créer une image IA", rw: "5. Gukora ifoto ya AI" },
  "guide.p5": { fr: "Ouvrez Nano Banana. Décrivez l'image, ajoutez jusqu'à 3 photos de produits ou envois, choisissez le format et appuyez sur Generate. L'image est enregistrée dans Your images ; « Use in a video » l'envoie au générateur comme référence.", rw: "Fungura Nano Banana. Sobanura ifoto, ongeraho amafoto agera kuri 3, uhitemo ishusho, ukande Generate. Ifoto ibikwa muri \"Your images\"; kanda \"Use in a video\" uyikoreshe muri video." },
  "guide.h2f": { fr: "6. Crédits", rw: "6. Credits" },
  "guide.p6": { fr: "1 crédit = 10 RWF. Voir Tarifs pour les prix. Le portefeuille de test est de l'argent fictif.", rw: "Credit 1 = 10 RWF. Reba Ibiciro. Ikofi y'igerageza ntabwo ari amafaranga nyayo." },
  "guide.h2g": { fr: "7. FAQ", rw: "7. Ibibazo" },

  // API page
  "api.h1": { fr: "L'<span class=\"grad\">API</span> du Video Studio", rw: "<span class=\"grad\">API</span> ya Video Studio" },
  "api.lead": { fr: "Tout ce que font les pages du studio passe par une petite API JSON. Vous pouvez l'appeler vous-même pour obtenir un prix, générer et récupérer vidéos et images.", rw: "Ibyo paji za studio zikora byose binyura muri API ntoya ya JSON. Nawe ushobora kuyikoresha ubona igiciro, ukora video n'amafoto." },
};

/** Template category names (lib/video-engine/templates.ts), drawn by the pages' scripts rather than written in HTML. */
const CATEGORY_NAMES: Record<string, Entry> = {
  all: { fr: "Tous", rw: "Byose" },
  product: { fr: "Produit", rw: "Igicuruzwa" },
  motion: { fr: "Animation", rw: "Animation" },
  "3d": { fr: "Animation 3D", rw: "Video za 3D" },
  ugc: { fr: "Avis clients (UGC)", rw: "Ubuhamya (UGC)" },
  tiktok: { fr: "TikTok", rw: "TikTok" },
  ads: { fr: "Publicités", rw: "Kwamamaza" },
  promo: { fr: "Affiches et offres", rw: "Amatangazo n'ibiciro" },
  marketplace: { fr: "Marketplace", rw: "Isoko" },
  cinematic: { fr: "Cinéma", rw: "Nka filime" },
};

/** Text a script writes (not in the HTML), in the current language; English when there is no translation. */
export function translate(key: string, english: string): string {
  const lang = currentLang();
  return lang === "en" ? english : (T[key]?.[lang] ?? english);
}

/** A category's name in the current language (English from the engine otherwise). */
export function categoryName(id: string, english: string): string {
  const lang = currentLang();
  return lang === "en" ? english : (CATEGORY_NAMES[id]?.[lang] ?? english);
}

export function currentLang(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    return LANGS.includes(v as Lang) ? (v as Lang) : "en";
  } catch {
    return "en";
  }
}

/** Puts the page in a language. The English original of each element is kept the first time, to switch back. */
export function applyLang(lang: Lang): void {
  document.documentElement.lang = lang === "rw" ? "rw" : lang;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((node) => {
    if (node.dataset.en === undefined) node.dataset.en = node.innerHTML;
    const entry = T[node.dataset.i18n ?? ""];
    // Trusted strings from this file only (no user text), so innerHTML is safe and keeps <b> and <span>.
    node.innerHTML = lang === "en" || !entry ? (node.dataset.en ?? "") : entry[lang];
  });
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-i18n-ph]").forEach((node) => {
    if (node.dataset.en === undefined) node.dataset.en = node.placeholder;
    const entry = T[node.dataset.i18nPh ?? ""];
    node.placeholder = lang === "en" || !entry ? (node.dataset.en ?? "") : entry[lang];
  });
  document.querySelectorAll<HTMLButtonElement>("[data-lang]").forEach((b) => b.classList.toggle("on", b.dataset.lang === lang));
}

export function setLang(lang: Lang): void {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // Private window: the choice lasts for this page only.
  }
  applyLang(lang);
  // Pages that draw text from data (template categories) redraw it.
  window.dispatchEvent(new Event("studio:lang"));
}
