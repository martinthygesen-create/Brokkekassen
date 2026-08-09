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
// Kodet som et simpelt data-array, så flere nemt kan tilføjes senere uden at
// røre selve flow-logikken.
const COMPLAINER_ARCHETYPES = [
  { id: 'indre', name: 'Den indre brokker', hint: 'Du holder det inde — men det siver ud via stikpiller og små hentydninger, ikke rå udbrud.' },
  { id: 'udadvendt', name: 'Den udadvendte', hint: 'Du brøler det ud uden filter — jo mere du overdriver, jo bedre.' },
  { id: 'passivaggressiv', name: 'Den passiv-aggressive', hint: '"Det er helt fint" — men tonen, pauserne og suk\'et siger noget helt andet.' },
  { id: 'martyr', name: 'Den martyr-agtige', hint: 'Du brokker dig ved at gøre dig selv til det evige offer — "det er jo altid mig der...".' },
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
// selve pointen i spillet (se CLAUDE.md). Under opbygningsrunderne vises
// desuden kun ens EGEN prompt/brok mens man stadig er ved at svare (for ikke
// at forudindtage andres svar) — allerede besvarede runder ligger i
// c.history, som er offentlig for alle så snart runden er færdig.
function redactComplainerFor(state, viewerId) {
  const c = state.complainer;
  if (!c || !c.active || (c.current && c.current.type === 'gameover')) return state;
  const isGuilty = !!(c.revealed && viewerId && viewerId === c.guiltyId);
  const safe = { ...c, guiltyId: undefined, youAreGuilty: isGuilty };
  if (safe.current) {
    const cur = { ...safe.current };
    if (cur.type === 'complain') {
      const myPrompt = viewerId && cur.prompts ? cur.prompts[viewerId] : undefined;
      cur.submittedCount = Object.keys(cur.texts || {}).length;
      const myText = viewerId && cur.texts ? cur.texts[viewerId] : undefined;
      cur.prompts = myPrompt !== undefined ? { [viewerId]: myPrompt } : {};
      cur.texts = myText !== undefined ? { [viewerId]: myText } : {};
    } else if (cur.type === 'vote') {
      const mine = viewerId && Object.prototype.hasOwnProperty.call(cur.votes || {}, viewerId);
      cur.voteCount = Object.keys(cur.votes || {}).length;
      cur.votes = mine ? { [viewerId]: cur.votes[viewerId] } : {};
    } else if (cur.type === 'judge') {
      const mine = viewerId && Object.prototype.hasOwnProperty.call(cur.votes || {}, viewerId);
      cur.voteCount = Object.keys(cur.votes || {}).length;
      cur.votes = mine ? { [viewerId]: cur.votes[viewerId] } : {};
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
