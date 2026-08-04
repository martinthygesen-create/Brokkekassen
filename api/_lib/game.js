// Ren spillogik til Brokspillet — ingen state-adgang her, kun funktioner der
// tager data ind og returnerer data ud. Ligger under _lib/ så den IKKE tæller
// med i Vercels 12-serverless-function-loft (kun filer direkte i /api gør).

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function shuffle(arr) {
  return arr.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

function buildOptions(correctLabel, distractorLabels) {
  const pool = [correctLabel, ...distractorLabels].slice(0, 4);
  const options = shuffle(pool);
  return { options, correctIndex: options.indexOf(correctLabel) };
}

const QUIPLASH_PROMPTS = [
  'Skriv den mest drilske kommentar til {target}',
  'Det mest pinlige {target} har gjort på denne ferie er...',
  '{target} ville aldrig overleve en dag uden...',
  'Den perfekte hævn over {target} lige nu er...',
  'Hvis {target} havde sit eget TV-show, ville det hedde...',
  'Den mest sandsynlige grund til at {target} brokker sig i morgen er...',
  '{target}s hemmelige superkraft er at være verdensmester i...',
  'Det {target} bruger alt for lang tid på hver dag er...',
  'Hvis {target} var en ret på menuen, ville den hedde...',
  '{target} ville helt sikkert brokke sig hvis...',
  'Den mest overdrevne undskyldning {target} kunne finde på er...',
  'Om 10 år brokker {target} sig stadig over...',
];

// Ægte real-world "brok der endte med et resultat"-trivia — blandes ind
// imellem rundens egne data-spørgsmål, så der er noget at grine af selv
// tidligt i en frisk brokkekasse uden meget historik endnu.
const WORLD_TRIVIA = [
  { question: 'I 1985 lancerede Coca-Cola en ny opskrift der fik så massivt brok fra kunderne, at de måtte tage den gamle tilbage efter kun 3 måneder. Hvad hed fadæsen?', correct: 'New Coke', distractors: ['Coca-Cola Zero', 'Cherry Coke', 'Coca-Cola Life'] },
  { question: 'Da Toblerone i 2016 ændrede formen for at spare på chokoladen, brokkede tusindvis af briter sig højlydt. Hvad var deres klage over?', correct: 'For store huller mellem trekanterne', distractors: ['For lille æske', 'Ny smag', 'Manglende nødder'] },
  { question: 'Microsoft fjernede Start-menuen i Windows 8 — og måtte give den tilbage i Windows 10 efter massivt brok. Hvad ville brugerne have tilbage?', correct: 'Start-menuen', distractors: ['Solitaire', 'Den blå skærm', 'Internet Explorer'] },
  { question: 'Facebook fik i årevis brok fra brugere der ville have en "dislike"-knap. Hvad indførte Facebook i stedet i 2016?', correct: 'Reaktioner (fx vred/ked af det)', distractors: ['En decideret dislike-knap', 'Anonyme kommentarer', 'Et klagepanel'] },
  { question: 'En berømt retssag i USA i 1994 handlede om en kunde der brokkede sig over alt for varm kaffe fra en fastfood-kæde. Hvilken kæde?', correct: "McDonald's", distractors: ['Burger King', 'KFC', 'Starbucks'] },
  { question: 'EU har regler om hvor krumme bananer og agurker må være til salg — ofte brugt som eksempel på "unødvendigt bureaukrati". Hvad handler reglerne officielt om?', correct: 'Kvalitetsklassificering ved salg', distractors: ['Miljøbeskyttelse', 'Skattefradrag', 'Transportsikkerhed'] },
  { question: 'Hvad kaldes en person i moderne slang, der er kendt for at brokke sig unødigt meget og forlange "at tale med chefen"?', correct: 'Karen', distractors: ['Susan', 'Karla', 'Debbie'] },
  { question: "Netflix' upopulære forbud mod login-deling på tværs af husstande fik massivt brok — men endte alligevel med at gøre hvad?", correct: "Øge Netflix' omsætning og antal abonnenter", distractors: ['Gå konkurs', 'Fjerne alle gebyrer igen', 'Skifte navn'] },
  { question: 'En britisk navnekonkurrence for et forskningsskib endte med det folkelige forslag "Boaty McBoatface". Hvad besluttede myndighederne til sidst?', correct: 'Skibet fik et andet navn — men en ubåd blev opkaldt Boaty McBoatface', distractors: ['Skibet hed officielt Boaty McBoatface', 'Konkurrencen blev aflyst', 'Navnet blev solgt på auktion'] },
  { question: 'Ryanair er berygtet for ekstra gebyrer rejsende brokker sig over. Hvilket af disse har Ryanair faktisk opkrævet gebyr for?', correct: 'Print af boardingkort i lufthavnen', distractors: ['At sidde i vinduespladsen', 'At tale engelsk ombord', 'Håndbagage under 1 kg'] },
  { question: 'Gap skiftede sit klassiske logo i 2010 — men måtte skifte tilbage efter kun én uge pga. massivt brok. Hvad var især problemet?', correct: 'Det nye logo blev anset for kedeligt og amatøragtigt', distractors: ['Det nye logo lignede en konkurrent', 'Det var for dyrt at trykke', 'Det kunne ikke læses af farveblinde'] },
  { question: 'Tropicana skiftede sin ikoniske appelsin-emballage i 2009 — men måtte tage den gamle tilbage efter kun 2 måneder, da salget styrtdykkede. Hvor meget faldt salget cirka?', correct: 'Ca. 20%', distractors: ['Ca. 2%', 'Ca. 50%', 'Ca. 80%'] },
  { question: 'Snapchat lancerede et upopulært redesign i 2018 — over 1,2 millioner underskrev en petition imod det. Hvad skete der med appen bagefter?', correct: 'Den mistede brugere, og aktien faldt', distractors: ['Den blev lukket permanent', 'Intet, brugerne vænnede sig hurtigt til det', 'Snapchat blev opkøbt af Instagram'] },
  { question: 'Pepsi trak i 2017 en reklame med Kendall Jenner tilbage efter massivt brok om at den bagatelliserede protestbevægelser. Hvor hurtigt blev den trukket?', correct: 'Under 24 timer', distractors: ['Efter en uge', 'Efter en måned', 'Den blev aldrig trukket'] },
  { question: 'Windows Vista fik SÅ meget brok for at være langsomt og irriterende, at Microsoft skyndte sig med efterfølgeren. Hvad hed den?', correct: 'Windows 7', distractors: ['Windows 8', 'Windows XP', 'Windows ME'] },
  { question: "Domino's Pizza indrømmede i en berømt reklamekampagne i 2009, at kundernes brok over smagen var berettiget. Hvad gjorde de?", correct: 'Opfandt en helt ny pizza-opskrift', distractors: ['Lukkede alle butikker', 'Sænkede priserne til det halve', 'Skiftede navn'] },
  { question: 'Fyre Festival i 2017 endte i massivt brok fra gæster der havde betalt formuer for luksus, men i stedet fik overlevelsestelte og hvilken berømt fiasko-servering?', correct: 'En ostesandwich', distractors: ['Rå fisk', 'Ingenting overhovedet', 'Tørret brød og vand' ] },
  { question: 'Reddit lancerede et nyt design i 2018 der fik så meget brok, at brugerne den dag i dag kan vælge det gamle design. Hvilken adresse virker stadig?', correct: 'old.reddit.com', distractors: ['classic.reddit.com', 'legacy.reddit.com', 'vintage.reddit.com'] },
  { question: 'McDonald\'s Szechuan-sauce fra 2017 udløste kaos og brok i butikkerne, da der var alt for lidt af den. Hvad gjorde kæden året efter?', correct: 'Genindførte saucen permanent', distractors: ['Fjernede den for altid', 'Hævede prisen til 50 dollars', 'Sagsøgte fansene'] },
  { question: 'Peloton fik massivt hån og brok for en julereklame i 2019, hvor en mand gav sin kone et motionscykel-abonnement i gave. Hvad skete der med Pelotons aktiekurs bagefter?', correct: 'Den faldt markant', distractors: ['Den steg markant', 'Ingen ændring', 'Aktien blev suspenderet'] },
];

// "Shuffle bag": trækker uden tilbagelægning fra en pulje af indeks, så intet
// gentages før ALT er brugt — brugte ting ryger bagerst i køen, ikke tilbage
// i puljen med det samme. Gemmes på RUM-niveau (ikke i selve spil-sessionen),
// så rotationen holder på tværs af flere afsluttede spil, ikke kun én omgang.
function pickFromBag(state, bagKey, poolLength) {
  if (!state.gameContentBank) state.gameContentBank = {};
  if (!state.gameContentBank.bags) state.gameContentBank.bags = {};
  let bag = state.gameContentBank.bags[bagKey];
  if (!bag || !bag.length) bag = shuffle(Array.from({ length: poolLength }, (_, i) => i));
  const idx = bag.pop();
  state.gameContentBank.bags[bagKey] = bag;
  return idx;
}

function pickQuiplashPrompt(state, members) {
  const target = pickRandom(members);
  const idx = pickFromBag(state, 'quiplash', QUIPLASH_PROMPTS.length);
  return { prompt: QUIPLASH_PROMPTS[idx].replace(/\{target\}/g, target.name), targetId: target.id };
}

function pickWorldTrivia(state) {
  const idx = pickFromBag(state, 'world', WORLD_TRIVIA.length);
  const item = WORLD_TRIVIA[idx];
  return { question: item.question, isWorld: true, ...buildOptions(item.correct, item.distractors) };
}

// Genererer et multiple-choice trivia-spørgsmål ud fra rummets EGNE rigtige
// brok-data — binder spillet sammen med selve Brokkekassen.
function generateTriviaQuestion(state) {
  const members = state.members;
  const allEvents = [...state.events, ...state.history.flatMap(r => r.events || [])].filter(e => !e.free && !e.voided);
  const counts = {};
  members.forEach(m => (counts[m.id] = 0));
  allEvents.forEach(e => { if (counts[e.memberId] !== undefined) counts[e.memberId]++; });
  const totalCount = allEvents.length;

  const candidates = [];

  if (totalCount > 0 && members.length >= 2) {
    const mostId = members.slice().sort((a, b) => counts[b.id] - counts[a.id])[0].id;
    candidates.push(() => {
      const correct = members.find(m => m.id === mostId).name;
      const distractors = members.filter(m => m.id !== mostId).map(m => m.name);
      const { options, correctIndex } = buildOptions(correct, distractors);
      return { question: 'Hvem har brokket sig flest gange i denne brokkekasse?', options, correctIndex };
    });
    const fewestId = members.slice().sort((a, b) => counts[a.id] - counts[b.id])[0].id;
    candidates.push(() => {
      const correct = members.find(m => m.id === fewestId).name;
      const distractors = members.filter(m => m.id !== fewestId).map(m => m.name);
      const { options, correctIndex } = buildOptions(correct, distractors);
      return { question: 'Hvem har brokket sig færrest gange i denne brokkekasse?', options, correctIndex };
    });
    candidates.push(() => {
      const correct = String(totalCount);
      const distractors = [...new Set([totalCount + 2, Math.max(0, totalCount - 2), totalCount + 5].map(String))];
      const { options, correctIndex } = buildOptions(correct, distractors);
      return { question: 'Hvor mange brok er der registreret i alt i denne brokkekasse?', options, correctIndex };
    });
  }

  const streakEntries = Object.entries(state.streaks || {}).filter(([id]) => members.find(m => m.id === id));
  if (streakEntries.length && members.length >= 2) {
    const [topId] = streakEntries.slice().sort((a, b) => b[1] - a[1])[0];
    const topMember = members.find(m => m.id === topId);
    if (topMember) {
      candidates.push(() => {
        const distractors = members.filter(m => m.id !== topId).map(m => m.name);
        const { options, correctIndex } = buildOptions(topMember.name, distractors);
        return { question: 'Hvem har den længste aktuelle streak uden brok?', options, correctIndex };
      });
    }
  }

  if (!candidates.length) {
    const distractors = [String(members.length + 1), String(Math.max(1, members.length - 1)), String(members.length + 2)];
    const { options, correctIndex } = buildOptions(String(members.length), [...new Set(distractors)]);
    return { question: 'Hvor mange medlemmer er der i denne brokkekasse?', options, correctIndex };
  }
  return pickRandom(candidates)();
}

// Sætter indholdet af en ny runde op — vælger tilfældigt mellem de tre
// rundetyper og bygger den nødvendige startdata for hver. `players` er de
// medlemmer der reelt er med i DENNE runde af spillet (kan være en delmængde
// af hele rummet) — trivia-spørgsmål handler stadig om hele rummets rigtige
// brok-historik, uanset hvem der spiller med lige nu.
const ROUND_TYPES = ['quiplash', 'truefalse', 'trivia'];

function beginRound(state, players) {
  state.game.round += 1;
  const playerIds = players.map(m => m.id);
  // Rundetypen trækkes fra samme slags "shuffle bag" som resten af indholdet
  // — sikrer en jævn blanding uden mønstre (fx samme type 3 runder i træk),
  // og rotationen holder også her på tværs af flere spil.
  const type = ROUND_TYPES[pickFromBag(state, 'roundType', ROUND_TYPES.length)];
  if (type === 'quiplash') {
    const { prompt, targetId } = pickQuiplashPrompt(state, players);
    state.game.current = { type, phase: 'answer', prompt, targetId, answers: {} };
  } else if (type === 'truefalse') {
    // Ca. hver 4. sandt/falsk-runde genbruges et udsagn fra et TIDLIGERE spil
    // (ikke fra denne runde af spillet selv) i stedet for at kræve en frisk
    // forfatter — content skal ikke gå til spilde, og det er sjovt at blive
    // mindet om gamle påstande, uden at det bliver et selv-citat midt i spillet.
    // Det mindst for nylig genbrugte udsagn vælges først, så et enkelt ikke
    // bliver ved med at dukke op igen og igen — brugte ting ryger bagerst i køen.
    const bank = (state.gameContentBank && state.gameContentBank.truefalse) || [];
    const reusable = bank.filter(e => playerIds.includes(e.targetId) && e.ts < state.game.startedAt);
    if (reusable.length && Math.random() < 0.25) {
      const old = reusable.slice().sort((a, b) => (a.lastUsedTs || 0) - (b.lastUsedTs || 0))[0];
      old.lastUsedTs = Date.now();
      state.game.current = { type, phase: 'guess', authorId: old.authorId, targetId: old.targetId, statement: old.statement, isTrue: old.isTrue, guesses: {}, reused: true };
    } else {
      const author = pickRandom(players);
      state.game.current = { type, phase: 'write', authorId: author.id, targetId: null, statement: null, isTrue: null, guesses: {} };
    }
  } else {
    // Ca. hver 3. trivia-runde er ægte real-world brok-trivia i stedet for
    // spørgsmål om rummets egne data — særlig kærkomment i et frisk rum
    // uden meget historik endnu.
    const q = Math.random() < 0.35 ? pickWorldTrivia(state) : generateTriviaQuestion(state);
    state.game.current = { type, phase: 'answer', ...q, choices: {} };
  }
}

module.exports = { pickRandom, shuffle, buildOptions, pickFromBag, pickQuiplashPrompt, pickWorldTrivia, generateTriviaQuestion, beginRound };
