// Rent INDHOLD til Det Store Brokkeri ("The Big Complainer") — arketyper,
// situationer og prompt-puljen. Selve spil-FLOWET (runder, mistankeafstemning,
// bank/gamble, afsløring, gættefinale) ligger i _lib/complainerFlow.js,
// samme opdeling som MrBrok's mrbrok.js/mrbrokFlow.js og Brokspillets
// game.js/gameFlow.js. Ligger under _lib/ så den IKKE tæller med i Vercels
// 12-serverless-function-loft.
//
// VIGTIGT (se CLAUDE.md's "Planlagt: The Big Complainer"-afsnit): dette er et
// HELT SELVSTÆNDIGT tredje spil, ikke en gren af MrBrok. Denne fil rører
// ALDRIG MRBROK_TOPICS eller andet MrBrok-indhold — egen uafhængig pulje.

const { pickRandom, shuffle } = require('./game');

// Arketyper — hver spiller får hemmeligt tildelt én, som styrer TONEN i
// deres brok (ikke selve emnet, det kommer fra situationen+prompten).
//
// VIGTIGT designvalg (produktejer-feedback, se commit-historikken): en bar
// personligheds-etiket alene ("den udadvendte") er for bredt og abstrakt til
// reelt at kunne spilles eller genkendes — "hvordan skal nogen nogensinde
// gætte det?". Hver arketype er derfor et KONKRET, fusioneret persona
// (erhverv/rolle + en brok-stil), ikke to løse akser — fx "Den
// passiv-aggressive pilot", ikke "pilot" og "passiv-aggressiv" hver for sig.
// Hver arketype bærer desuden 2-3 EKSPLICITTE, konkrete spille-instruktioner
// (ikke bare ét vagt trait-ord) — det er dem der reelt sænker barren for at
// spille rollen sjovt med det samme, jf. produktejerens egen begrundelse:
// alt skal hinte mod rollen, men instruktioner om SELVE BROK-STILEN gør det
// nemt at gå i gang uden yderligere forberedelse. ~10 stykker, med bredt
// forskellige erhverv/personaer OG forskellig underliggende brok-stil på
// tværs af puljen — ikke bare 10 gensyn med samme 4 stilarter.
const COMPLAINER_ARCHETYPES = [
  {
    id: 'pilot', name: 'Den passiv-aggressive pilot',
    instructions: [
      'Det er altid andres skyld — aldrig dit eget ansvar.',
      'Du er højrøstet og overdriver gerne.',
      'Smil stift mens du siger det værste.',
    ],
  },
  {
    id: 'kok', name: 'Den udadvendte kok',
    instructions: [
      'Du råber det ud med det samme — helt uden filter.',
      'Overdriv følelserne teatralsk, gerne med håndbevægelser.',
      'Du er dybt fornærmet hvis nogen tvivler på din smag.',
    ],
  },
  {
    id: 'nabo', name: 'Den indre-brokkende nabo',
    instructions: [
      'Sig "det er helt fint" — men lad stilheden bagefter tale.',
      'Brug stikpiller og hentydninger i stedet for at sige det ligeud.',
      'Skift emne brat hvis nogen spørger direkte ind til det.',
    ],
  },
  {
    id: 'foraelder', name: 'Den martyr-agtige forælder',
    instructions: [
      'Det er altid dig der ofrer dig — nævn det, ubedt.',
      'Sammenlign med alt det du "kunne" have gjort i stedet.',
      'Afslut med et dybt suk og "det er jo helt fint, jeg klarer det".',
    ],
  },
  {
    id: 'projektleder', name: 'Den passiv-aggressive projektleder',
    instructions: [
      'Send indirekte hip via "bare lige en tanke..." — aldrig direkte kritik.',
      'Ros først, stik så kniven ind med et "men".',
      'Brug ordet "interessant" som skjult kritik.',
    ],
  },
  {
    id: 'laerer', name: 'Den udadvendte lærer',
    instructions: [
      'Du taler højt og bruger hele kroppen når du brokker dig.',
      'Inddrag "os alle sammen" i din vrede, som en fælles sag.',
      'Du elsker en god pointe og gentager den gerne tre gange.',
    ],
  },
  {
    id: 'fitness', name: 'Den martyr-agtige fitnessinstruktør',
    instructions: [
      'Du giver ALT for andre, og ingen forstår hvor hårdt det er.',
      'Nævn hvor tidligt du står op, for andres skyld.',
      'Antyd at ingen ville klare sig uden dig.',
    ],
  },
  {
    id: 'taxachauffoer', name: 'Den indre-brokkende taxachauffør',
    instructions: [
      'Mumle det halvt for dig selv i stedet for at sige det direkte.',
      'Brug en tør, underspillet tone — aldrig råb.',
      'Lad en lang pause tale for dig efter en stikpille.',
    ],
  },
  {
    id: 'influencer', name: 'Den passiv-aggressive influencer',
    instructions: [
      'Pak alt ind i positivitet — "helt fint, bare synd at...".',
      'Vær sødt giftig — "haha nej men altså" mens du sviner.',
      'Understreg at "jeg siger det jo bare i kærlighed".',
    ],
  },
  {
    id: 'haandvaerker', name: 'Den udadvendte håndværker',
    instructions: [
      'Du brokker dig højt og direkte, uden omsvøb.',
      'Brug konkrete, fysiske eksempler — "det tog MIG tre timer at rette".',
      'Du er stolt af at sige tingene ligeud — "nogen må jo sige det".',
    ],
  },
];

// De "everyday"-situationer alle spillere trækkes tilfældigt mellem — styrer
// hvilken kategori af prompts man får tilbudt.
const COMPLAINER_SITUATIONS = ['chef', 'nabo', 'familie', 'kollega', 'ven'];

// Prompt-puljen. `category` matcher enten en af COMPLAINER_SITUATIONS
// (situations-specifik) eller 'relational' (kan bruges af alle uanset
// situation — de "relationelle vinkel"-spørgsmål fra konceptet, der skaber
// en lille ironisk dobbeltlags-karakter: en brokker der ikke selv ser sin
// egen rolle i andres brok). `tier` 1-3 styrer eskalering hen over runderne
// (1 = bred åbner, 3 = skarp/personlig). Bevidst IKKE vandede/vage formuleringer
// — produktejeren har været eksplicit om at der skal være max saft, alle
// brokker sig hårdt i karakter.
const COMPLAINER_PROMPTS = [
  // --- chef ---
  { id: 'chef1', category: 'chef', tier: 1, text: 'Hvad er det seneste din chef har bedt dig om, som fik dig til at trække vejret dybt først?' },
  { id: 'chef2', category: 'chef', tier: 2, text: 'Nævn en konkret ting din chef siger igen og igen, som du er dødtræt af at høre.' },
  { id: 'chef3', category: 'chef', tier: 3, text: 'Hvad brokker du dig over til din chef, som du aldrig ville sige højt derhjemme?' },
  { id: 'chef4', category: 'chef', tier: 3, text: 'Beskriv det møde med din chef, du helst ville have sluppet for at deltage i.' },
  // --- nabo ---
  { id: 'nabo1', category: 'nabo', tier: 1, text: 'Hvad er det første, du lagde mærke til ved din nabo, som irriterede dig?' },
  { id: 'nabo2', category: 'nabo', tier: 2, text: 'Beskriv den lyd fra din nabo, du kan genkende med lukkede øjne — og hader.' },
  { id: 'nabo3', category: 'nabo', tier: 3, text: 'Hvad er det værste din nabo nogensinde har gjort, uden selv at ane det?' },
  // --- familie ---
  { id: 'familie1', category: 'familie', tier: 1, text: 'Hvad siger et familiemedlem altid til dig, som du er træt af at høre?' },
  { id: 'familie2', category: 'familie', tier: 2, text: 'Nævn en tradition i din familie, du helst ville skippe, men aldrig tør sige det højt.' },
  { id: 'familie3', category: 'familie', tier: 3, text: 'Hvad er det værste nogen i din familie har sagt til dig, som du stadig ikke forstår hvorfor du skal høre på?' },
  // --- kollega ---
  { id: 'kollega1', category: 'kollega', tier: 1, text: 'Hvad gør en kollega, som får dig til at rulle med øjnene hver gang?' },
  { id: 'kollega2', category: 'kollega', tier: 2, text: 'Beskriv den kollega der altid får æren for dit arbejde — uden at nævne navn.' },
  { id: 'kollega3', category: 'kollega', tier: 3, text: 'Hvad har en kollega gjort, som du aldrig helt har tilgivet dem for?' },
  // --- ven ---
  { id: 'ven1', category: 'ven', tier: 1, text: 'Hvad er den mest irriterende vane en ven af dig har?' },
  { id: 'ven2', category: 'ven', tier: 2, text: 'Nævn en gang en ven svigtede en aftale — og hvordan de bortforklarede det.' },
  { id: 'ven3', category: 'ven', tier: 3, text: 'Hvad er det du aldrig har turdet sige til en ven, selvom det brænder i dig?' },
  // --- relational (bruges af alle, uanset situation) ---
  { id: 'rel1', category: 'relational', tier: 1, text: 'Hvem brokker sig mest til DIG, og hvad siger de?' },
  { id: 'rel2', category: 'relational', tier: 2, text: 'Hvad er det værste nogen har sagt til dig, som du stadig ikke forstår hvorfor du skal høre på?' },
  { id: 'rel3', category: 'relational', tier: 3, text: 'Hvad brokker du dig over til din chef, som du aldrig ville sige højt derhjemme?' },
  { id: 'rel4', category: 'relational', tier: 3, text: 'Hvem i dit liv ville blive mest overrasket over at høre, at du brokker dig over dem — og hvad ville de høre?' },
];

// Vælger arketype + situation til hver spiller. Ikke vægtet/roterende som
// MrBrok's pickMrBrok — Det Store Brokkeri er endnu ung nok til at et simpelt
// tilfældigt shuffle er fint (kan senere udbygges med samme
// gentagelses-modstand hvis det bliver et problem i praksis).
function assignArchetypesAndSituations(players) {
  const archetypes = {};
  const situations = {};
  players.forEach(p => {
    archetypes[p.id] = pickRandom(COMPLAINER_ARCHETYPES).id;
    situations[p.id] = pickRandom(COMPLAINER_SITUATIONS);
  });
  return { archetypes, situations };
}

// Ønsket tier for en given runde ud af det samlede antal opbygningsrunder —
// jævnt fordelt tredjedele, så et 4-runders spil fx giver tier 1,2,2,3 og et
// 6-runders spil giver 1,1,2,2,3,3.
function tierForRound(round, totalRounds) {
  const third = Math.max(1, Math.ceil(totalRounds / 3));
  if (round <= third) return 1;
  if (round <= third * 2) return 2;
  return 3;
}

// Vælger en prompt til en spiller for en given runde: matcher spillerens
// situation (eller 'relational', som er åben for alle), prioriterer den
// ønskede eskalerings-tier, og undgår prompts spilleren allerede har fået i
// dette spil. Falder gradvist tilbage (forkert tier, så hvilken som helst
// kategori) frem for nogensinde at returnere ingenting.
function pickPromptFor(playerId, situation, round, totalRounds, usedIds) {
  const used = new Set(usedIds || []);
  const desiredTier = tierForRound(round, totalRounds);
  const eligible = (tier, anyCategory) => COMPLAINER_PROMPTS.filter(p =>
    !used.has(p.id) &&
    (anyCategory || p.category === situation || p.category === 'relational') &&
    p.tier === tier
  );
  let pool = eligible(desiredTier, false);
  if (!pool.length) pool = COMPLAINER_PROMPTS.filter(p => !used.has(p.id) && (p.category === situation || p.category === 'relational'));
  if (!pool.length) pool = COMPLAINER_PROMPTS.filter(p => !used.has(p.id));
  if (!pool.length) pool = COMPLAINER_PROMPTS; // hele puljen brugt — så må noget gå igen
  return pickRandom(pool);
}

// Det Store Brokkeri gemmer en hemmelighed i state.complainer (hvem der er "Den
// Store Brokker") — men hele state sendes som én samlet JSON-blob til
// klienten ved hver poll/handling (se api/state.js), så vi maskerer det
// hemmelige felt ud fra HVEM der kigger, hver gang state serialiseres.
// Samme filosofi som _lib/store.js's redactStateFor for MrBrok — ligger her
// (og ikke i store.js) udelukkende for at undgå en cirkulær require med
// _lib/complainerFlow.js, som selv bruger store.js's uid().
//
// Skyldig-identiteten holdes hemmelig for ALLE (inklusive den skyldige selv)
// indtil c.revealed bliver sat af beginReveal() i complainerFlow.js — det er
// selve pointen i spillet (se CLAUDE.md). Opbygningsrundernes brok siges HØJT
// ved bordet (se beginComplainRound i complainerFlow.js) — der er intet
// tekstfelt og intet der gemmes af selve ordlyden, kun HVEM der har turen
// (order/turnIndex/speakerId) og HVILKEN prompt de fik, hvilket ikke er
// hemmeligt for nogen — så 'complain'-fasen kræver ingen redaktion
// overhovedet, i modsætning til vote/judge som stadig er hemmelige
// afstemninger indtil alle har stemt.
function redactComplainerFor(state, viewerId) {
  const c = state.complainer;
  if (!c || !c.active || (c.current && c.current.type === 'gameover')) return state;
  const isGuilty = !!(c.revealed && viewerId && viewerId === c.guiltyId);
  const safe = { ...c, guiltyId: undefined, youAreGuilty: isGuilty };
  if (safe.current) {
    const cur = { ...safe.current };
    if (cur.type === 'vote') {
      const mine = viewerId && Object.prototype.hasOwnProperty.call(cur.votes || {}, viewerId);
      cur.voteCount = Object.keys(cur.votes || {}).length;
      cur.votes = mine ? { [viewerId]: cur.votes[viewerId] } : {};
    } else if (cur.type === 'judge') {
      const mine = viewerId && Object.prototype.hasOwnProperty.call(cur.votes || {}, viewerId);
      cur.voteCount = Object.keys(cur.votes || {}).length;
      cur.votes = mine ? { [viewerId]: cur.votes[viewerId] } : {};
    } else if (cur.type === 'bet') {
      // EXPERIMENTAL "Udfordring" (se applyComplainerChallenge i
      // complainerFlow.js): den fulde stemmefordeling er normalt skjult
      // (kun cur.topId — vinderen — er offentlig), og afsløres kun for alle
      // hvis nogen bruger deres udfordring denne runde.
      if (!cur.challenged) cur.tally = undefined;
    }
    safe.current = cur;
  }
  return { ...state, complainer: safe };
}

module.exports = {
  COMPLAINER_ARCHETYPES,
  COMPLAINER_SITUATIONS,
  COMPLAINER_PROMPTS,
  assignArchetypesAndSituations,
  pickPromptFor,
  tierForRound,
  redactComplainerFor,
};
