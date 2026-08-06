// Rent INDHOLD til MrBrok — emner, hvem der bliver MrBrok, hint-forslag.
// Selve spil-FLOWET (tur-rækkefølge, afstemning, elimination) ligger i
// _lib/mrbrokFlow.js, ligesom Brokspillets indhold/flow er delt mellem
// _lib/game.js og _lib/gameFlow.js. Ligger under _lib/ så den IKKE tæller
// med i Vercels 12-serverless-function-loft.

const { pickFromBag, pickWeighted } = require('./game');

// Vælger hvem der bliver MrBrok: vægtet tilfældigt efter hvor mange gange
// man har haft rollen før — færre gange giver højere chance, men man kan
// sagtens blive det to gange i træk (ligesom i rigtig Mr. White), det er
// kun over mange spil det skal jævne sig ud. Gemt på RUM-niveau (samme sted
// som resten af indholds-rotationen), så det holder på tværs af flere spil
// i stedet for at nulstille sig selv ved hvert nyt MrBrok-spil.
function pickMrBrok(state, players) {
  if (!state.gameContentBank) state.gameContentBank = {};
  if (!state.gameContentBank.mrBrokPickCounts) state.gameContentBank.mrBrokPickCounts = {};
  const counts = state.gameContentBank.mrBrokPickCounts;
  const chosen = pickWeighted(players, counts);
  counts[chosen.id] = (counts[chosen.id] || 0) + 1;
  return chosen;
}

// Brede brok-scenarier — bevidst ikke for specifikke, så både MrBrok kan
// bluffe plausibelt OG de der reelt kender emnet skal svare vagt for ikke
// at afsløre for meget. Genbruger samme shuffle-bag-rotation som resten af
// indholdet, så de ikke gentages før hele puljen er brugt.
const MRBROK_TOPICS = [
  'En nabo der altid larmer for meget',
  'En kollega der aldrig tager sin del af opvasken på arbejdet',
  'Et familiemedlem der altid kommer for sent',
  'En håndværker der aldrig dukker op til tiden',
  'En restaurant med alt for langsom betjening',
  'En ven der aldrig betaler sin del tilbage',
  'Et flyselskab der mistede bagagen',
  'En teenager der aldrig rydder op efter sig selv',
  'En chef der altid tager æren for andres arbejde',
  'Et supermarked der hele tiden er løbet tør for det du skal bruge',
  'En taxachauffør der kører den lange vej',
  'En eksmakker der stadig ringer alt for tit',
  'Et hotelværelse med udsigt til en mur',
  'En sælger der ikke vil tage nej for et svar',
  'Naboens hund der gør hele natten',
  'En fest hvor musikken aldrig stopper',
  'En internetudbyder der ikke kan finde ud af at reparere fejl',
  'En bilmekaniker der opfinder problemer der ikke findes',
  'Et fly der er forsinket i timevis uden forklaring',
  'En kollega der altid tager æren i møder',
];

function pickTopic(state) {
  const idx = pickFromBag(state, 'mrbrokTopic', MRBROK_TOPICS.length);
  return MRBROK_TOPICS[idx];
}

// Forslag til en VINKEL på ens clue (aldrig et svar/ord) — vises kun til
// den der har turen lige nu, via "Brug for et hint?"-knappen, ren client-
// side hjælp (se index.html). Holdes her sammen med resten af MrBroks
// indhold, selvom de reelt kunne have ligget rent client-side — samlet ét
// sted er lettere at redigere/udvide.
const MRBROK_CLUE_TIPS = [
  'Beskriv en følelse forbundet med det',
  'Nævn et sted det typisk sker',
  'Sammenlign det med noget helt andet',
  'Beskriv en lyd eller lugt der hører til',
  'Sig hvornår på dagen/ugen det sker',
  'Nævn hvem der typisk er involveret',
  'Beskriv hvordan det starter',
  'Beskriv hvordan det plejer at ende',
  'Brug et tal eller en mængde',
  'Beskriv noget man IKKE bør gøre i den situation',
  'Sammenlign størrelsen eller mængden af det',
  'Beskriv hvordan man har det bagefter',
  'Nævn noget det minder dig om fra din egen hverdag',
  'Beskriv det med kun ét ord, meget vagt',
  'Sig noget om hvor tit det sker',
];

module.exports = { MRBROK_TOPICS, MRBROK_CLUE_TIPS, pickTopic, pickMrBrok };
