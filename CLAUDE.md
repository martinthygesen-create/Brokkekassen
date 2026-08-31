# CLAUDE.md

Instruktioner og kontekst til fremtidige Claude Code-sessioner på dette repo.

## Projektet

Brokkekassen er en dansk familie-ferie-PWA med et fælles regnskab ("krukken")
og to mini-spil, delt via `activeApp` i `index.html`:

- **Brokspillet** (`activeApp = 'spil'`) — quiz/afstemnings-mini-spil (quiplash,
  sandt/falsk, trivia, guessbrok, casinobrok, rose). Logik i `api/game.js`,
  `api/_lib/game.js`, `api/_lib/gameFlow.js`.
- **MrBrok** (`activeApp = 'mrbrok'`) — Mr. White-agtigt social deduktionsspil.
  Logik i `api/mrbrok.js`, `api/_lib/mrbrok.js`, `api/_lib/mrbrokFlow.js`.

Begge deler rummets lobby/medlemmer (`state.members`) og regnskab, men har hver
sin egen `state.game`/`state.mrbrok`-gren og kan ikke være aktive samtidig i
samme rum.

## Planlagt: "The Big Complainer" — VIGTIGT arkitektur-krav

Der er under overvejelse et **helt nyt, tredje standalone spil** (arbejdstitel
"The Big Complainer" / "Den Store Brokker"), IKKE en videreudvikling eller
variant af MrBrok — selvom det oprindeligt blev diskuteret som "et omvendt
MrBrok".

**Det er IKKE en erstatning for MrBrok.** MrBrok skal blive ved med at
eksistere og fungere uændret som sit eget spil. The Big Complainer er et
TREDJE valg ved siden af Brokspillet og MrBrok — ikke en afløser for nogen
af dem.

**Når/hvis dette bygges, skal det:**
- Være sit eget spil med egen `state`-gren (fx `state.bigComplainer`), egen
  `api/bigcomplainer.js` + `api/_lib/bigComplainerFlow.js`, egen
  `activeApp`-værdi — ikke bygges ind i eller forgrene sig fra
  `state.mrbrok`/`api/mrbrok.js`.
- Må godt **genbruge delte elementer** hvor det giver mening — fx rummets
  lobby/spillervalg-UI, medlemslisten, push-mønsteret, `mutateState`-CAS-
  mønsteret osv. — men kun ved at referere til de samme DELTE helper-
  funktioner/komponenter, aldrig ved at hooke ind i eller forgrene MrBroks
  egen state/flow.
- **Må ikke kunne påvirke Brokspillet eller MrBrok** — hverken deres state,
  deres "kun ét spil aktivt ad gangen i et rum"-regel (det tredje spil skal
  indgå i den samme gensidige udelukkelse, ikke omgå den), eller deres
  indholdspuljer (fx MrBrok's `MRBROK_TOPICS`/`pickTopic`-rotation).

Kort sagt: samme fundament, tre uafhængige spil ovenpå — ikke ét spil der
forgrener sig i tre retninger.

Koncept-noter (arketyper, opbygningsrunder, mistankeafstemning, organisk
afsløring, gættefinale) er ikke skrevet ned et fast sted endnu — spørg
Martin om det fulde koncept-notat før implementering påbegyndes.

## Langsigtet retning: "…Kassen" — generisk rundemotor

Brokkekassen skal på sigt udvikle sig til en mere generisk platform
("…Kassen"), hvor den nuværende runde-motor genbruges på tværs af flere
spiltyper — ikke kun de spil der findes i dag. Dette er IKKE noget der skal
bygges nu, men det er vigtig kontekst: hold genbrugbarhed for øje i alt nyt
arbejde, og undgå at hardcode ting specifikt til ét spil, når det med lidt
omtanke kan holdes generisk.

De genbrugelige runde-elementer, der allerede findes i koden:

- `roomId` — isolerer én gruppe/session, deles via link (ingen kode/login)
- `members[]` — navngivne deltagere, identificeres på tværs af enheder
- `pending` — ét "aktivt øjeblik" ad gangen (i dag: en påstand der afventer
  stemmer); kan genbruges til aktivt spørgsmål, aktivt hjul-spin, aktiv
  trækning
- `votes[]` + `need` — tærskel-baseret bekræftelse (2/3 osv.); kan genbruges
  til peer-godkendelse ELLER erstattes af vært-godkendelse (facit-mode)
- `events[]` — løbende feed af bekræftede hændelser i runden; kan genbruges
  til spørgsmål/svar-historik, hjul-resultater
- `createdAt` — runde-start, bruges til "dag X"
- `history[]` — arkiv af lukkede runder m. totals pr. medlem; kan genbruges
  til quiz-score over flere dage, wheel-gevinster over tid
- `settle()` — lukker runde, nulstiller, arkiverer; kan genbruges uændret
  til enhver rundetype

Mangler stadig (ikke bygget endnu): roller (admin/host), spørgsmålskø,
randomizer-komponent, facit-godkendelse, hold-struktur.

## Én branch, ingen preview

Der køres bevidst med ÉN branch (`claude/brokkekassen-famille-setup-ixh41o`)
som også er prod-branchen — intet preview-setup i Vercel. Nyt arbejde
(inklusive The Big Complainer) skal derfor også committes direkte til denne
branch, IKKE en ny feature-branch — det er en bevidst simplicitets-
beslutning, ikke en forglemmelse.

Da flere Claude Code-sessioner kan arbejde på repoet samtidig på præcis
denne ene branch, er disciplinen omkring `git fetch`/fast-forward FØR hver
push ekstra vigtig — se den gentagne "stale lokal checkout"-problematik i
commit-historikken. Altid: `git fetch origin <branch>` og sammenlign mod
`origin/<branch>` før en push, aldrig antag at lokal HEAD er ajour.
