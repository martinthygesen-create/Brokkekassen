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

function pickQuiplashPrompt(members) {
  const target = pickRandom(members);
  const tpl = pickRandom(QUIPLASH_PROMPTS);
  return { prompt: tpl.replace(/\{target\}/g, target.name), targetId: target.id };
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
function beginRound(state, players) {
  state.game.round += 1;
  const type = pickRandom(['quiplash', 'truefalse', 'trivia']);
  if (type === 'quiplash') {
    const { prompt, targetId } = pickQuiplashPrompt(players);
    state.game.current = { type, phase: 'answer', prompt, targetId, answers: {} };
  } else if (type === 'truefalse') {
    const author = pickRandom(players);
    state.game.current = { type, phase: 'write', authorId: author.id, targetId: null, statement: null, isTrue: null, guesses: {} };
  } else {
    const q = generateTriviaQuestion(state);
    state.game.current = { type, phase: 'answer', ...q, choices: {} };
  }
}

module.exports = { pickRandom, shuffle, buildOptions, pickQuiplashPrompt, generateTriviaQuestion, beginRound };
