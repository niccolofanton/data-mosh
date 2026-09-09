# Come è fatto un buon articolo Codrops

Guideline strutturale e stilistica ricavata da **10 articoli** di tympanus.net/codrops,
selezionati su 1.672 per affinità con una demo WebGL di datamosh, letti integralmente e
misurati.

Il documento è descrittivo prima che prescrittivo: ogni regola qui dentro è un
comportamento **osservato e contato** nel corpus, non un consiglio generico di scrittura
tecnica. Dove il corpus si contraddice, lo dico invece di scegliere la versione più comoda.

---

## Indice

1. [Il corpus e il metodo](#1-il-corpus-e-il-metodo)
2. [La prima decisione: il genere](#2-la-prima-decisione-il-genere)
3. [I numeri di riferimento](#3-i-numeri-di-riferimento)
4. [Lo scheletro](#4-lo-scheletro)
5. [L'apertura](#5-lapertura)
6. [I titoli di sezione](#6-i-titoli-di-sezione)
7. [Prosa e codice](#7-prosa-e-codice)
8. [La cadenza visiva](#8-la-cadenza-visiva)
9. [La voce](#9-la-voce)
10. [Come si spiega un concetto difficile](#10-come-si-spiega-un-concetto-difficile)
11. [La chiusura](#11-la-chiusura)
12. [Le assenze sistemiche](#12-le-assenze-sistemiche)
13. [Anti-pattern osservati](#13-anti-pattern-osservati)
14. [Checklist finale](#14-checklist-finale)

---

## 1. Il corpus e il metodo

Dieci articoli, 2024-2026 salvo dove indicato, scelti perché condividono un nucleo tecnico:
shader scritti a mano, post-processing, render-to-texture, degradazione voluta dell'immagine.

| Articolo | Anno | Categoria | Parole | Blocchi |
|---|---|---|---|---|
| Pixel-to-Voxel Video Drop (Three.js + Rapier) | 2026 | Tutorials | 2365 | 14 |
| Building The Monolith (13-scene WebGL epic) | 2025 | Articles | 1690 | 8 |
| Building Efficient Three.js Scenes | 2025 | Articles | 1628 | 10 |
| Distortion and Grain on Scroll | 2024 | Tutorials | 1524 | 13 |
| Efecto: ASCII and Dithering Effects | 2026 | Articles | 1519 | 8 |
| Grid Displacement + RGB Shift (GPGPU) | 2024 | Tutorials | 1316 | 20 |
| Composite Rendering | 2026 | Articles | 1149 | 9 |
| PS1-Inspired Jitter Shader | 2024 | Tutorials | 602 | 4 |
| Building a Real-Time Dithering Shader | 2025 | Articles | 568 | 4 |
| WebGPU Scanning Effect with Depth Maps | 2025 | Playground | 415 | 6 |

**Avvertenza metodologica.** Convertendo le pagine in markdown si perdono i tag `<video>` e
`<iframe>`: chi conta i media sul testo estratto conclude l'opposto del vero sulla cadenza
visiva. Il Monolith, per dire, ha 7 video autoplay invisibili nell'estrazione. Tutti i numeri
sui media in questo documento vengono dall'HTML originale.

---

## 2. La prima decisione: il genere

**È la scelta che determina tutto il resto**, e va fatta prima di scrivere una riga. Codrops
ha tre contenitori con tre patti diversi verso il lettore.

| | **Tutorials** | **Articles** (build log / case study) | **Playground** |
|---|---|---|---|
| Patto | "alla fine sai farlo" | "alla fine capisci perché è fatto così" | "guarda questa cosa" |
| Soggetto delle frasi | un *noi* che lavora adesso | l'autore che ha già finito | il fenomeno |
| Ruolo del lettore | esecutore | testimone | spettatore |
| Ruolo del codice | il prodotto, copiabile | una citazione che rende concreta una tesi | indice ragionato del repo |
| Densità di codice | **5-6 parole per riga** | **9-31 parole per riga** | variabile |
| Blocchi | tanti e incrementali | pochi e citazionali | pochi |
| Repo | obbligatorio | consigliato | è il contenuto |
| Lunghezza tipica | 1300-2400 | 1100-1700 | 400-600 |

Il corpus mostra due modi di fallire, entrambi per genere sbagliato:

- **Il tutorial troppo corto** (PS1, 602 parole): la prosa smette di spiegare e diventa
  didascalia del codice, la teoria resta nell'intro e non si ricongiunge mai
  all'implementazione. Non è abbastanza narrativo per essere piacevole né abbastanza completo
  per essere usabile.
- **Il build log senza repo** (Efecto, Composite Rendering): il lettore esce ispirato e
  informato ma **non capace**, e ogni frase tipo *"In the demo, I introduced a `BaseScene`
  class"* diventa un assegno scoperto.

> **Regola.** Se il lettore non può ragionevolmente ricostruire la cosa da zero seguendo un
> percorso lineare — pipeline a più pass, sistemi che si intrecciano, mesi di lavoro — scrivi
> un **Article**, e daglì il repo lo stesso. Se può, scrivi un **Tutorial** e non risparmiare
> sui blocchi di codice.

---

## 3. I numeri di riferimento

Misurati sul corpus (mediana, e intervallo utile osservato).

| Metrica | Mediana | Intervallo |
|---|---|---|
| Parole di prosa | **1.417** | 415 – 2.365 |
| Blocchi di codice | **8** | 4 – 20 |
| Righe di codice totali | **124** | 44 – 337 |
| Righe per blocco (mediana) | **9** | 4,5 – 27,5 |
| Titoli H2 | **5** | 1 – 9 |
| Parole per riga di codice | **9,2** | 3,9 – 31,6 |
| Parole per paragrafo | **34** | 20 – 48 |
| Parole per frase | **16** | 12 – 22 |
| Un elemento visivo ogni… | ~250 parole | 56 – 375 |

**Sulla densità prosa/codice si è aperta una contraddizione nel cluster, e va sciolta.** Una
coppia di articoli dava 11,3 e 11,8 e da lì si concludeva che il rapporto fosse invariante.
Sul corpus intero non lo è: va da 3,9 (Grid Displacement) a 31,6 (Efecto). Non è rumore, è
**il genere che si manifesta**: i tutorial stanno sotto le 6, i build log sopra le 9. Quello
che è davvero costante è un'altra cosa — che **il carico totale sul lettore resta uguale**:
chi taglia il codice alza le immagini (Efecto: 31,6 parole per riga di codice *e* un visivo
ogni 56 parole), chi alza il codice tiene i blocchi piccoli e mette un visivo ogni tre.

---

## 4. Lo scheletro

Quattro parti, in quest'ordine. I budget in parole sono su un pezzo da ~1.800.

### Parte 0 — Testata (non la scrivi tu, ma ci conti sopra)

Il template WordPress mette **sopra la prima riga**: byline e data, H1, **dek** di 17-21
parole, riga di tag, **cover image**, bottoni **Demo | Code | Visit**. Cinque elementi che
riempiono lo schermo prima della tua prima parola.

Conseguenza operativa: **non rifare il lavoro del dek**. È l'errore più comune, e nel corpus
la frase più debole del tutorial PS1 è esattamente la parafrasi del proprio dek.

### Parte 1 — Intro senza titolo · 60-210 parole

Nessun H2. Nel corpus questa sezione misura ~190-210 parole nei build log e ~60 nei tutorial.
Contiene: cosa costruiamo, con che stack, e — nei pezzi migliori — **il perché personale**.

### Parte 2 — Corpo · 55-65%

Da 3 a 9 H2. Se sono passi di una costruzione, **numerali** (e numera solo quelli: i
sotto-passi restano senza numero, così la gerarchia si legge a colpo d'occhio). Se sono facce
di un oggetto già costruito, non numerarli.

### Parte 3 — Coda tripartita · 25-30%

Questa è la parte che distingue gli articoli buoni da quelli dimenticabili, ed è **tre
sezioni separate con tre funzioni**, non una:

1. **Implementation Notes / Gotchas** (~300 parole) — limiti, trade-off, costi, trappole
   dell'API, ottimizzazioni non fatte e perché. È l'unica parte di un case study che sia
   davvero copiabile.
2. **Wrap-Up** (~100 parole) — varianti concrete e nominate (cinque, non "sperimenta pure"),
   e **cosa farai tu dopo**: è ciò che rende l'invito credibile invece che rituale.
3. **Final Thoughts** (~150 parole) — nessuna tecnica. Crediti nominali, ringraziamenti,
   chiusura personale.

Nel corpus le due sezioni più lunghe dell'articolo migliore valgono il **29% del testo e non
aggiungono nessuna feature**: una spiega perché il trucco funziona, l'altra cosa non funziona.

---

## 5. L'apertura

**L'incipit è formulare, ed è giusto che lo sia.** Il corpus è quasi unanime:

> "In this post, we'll take a closer look at the dithering-shader project: a minimal,
> real-time ordered dithering effect built using GLSL and the Post Processing library."

> "In this tutorial, we'll explore how to use Three.js and shaders to take a regular video,
> pixelate the 2D feed, and extrude those results into 3D voxels, finally controlling them
> with the Rapier physics engine."

Tre proprietà da riprodurre:

1. **La prima frase è una catena di verbi che è già l'indice.** *take a video → pixelate →
   extrude → control with physics* sono esattamente i tre step che seguono. In 35 parole il
   lettore ha la mappa completa senza che gli si annunci una mappa. **Questo sostituisce
   l'indice**, che non esiste su Codrops.
2. **La tecnologia entro le prime 25-35 parole.** Nessuno costruisce suspense sullo stack.
3. **Nessuna ambientazione, nessun "have you ever wondered".** Zero occorrenze nel corpus.

**Poi, subito, una di queste due mosse** — sono le due aperture che funzionano:

- **Spedire a guardare.** *"Let's kick things off by taking a look at the demo."* seguito dal
  video, e poi reagire *insieme* al lettore. Nel pezzo migliore il primo elemento in movimento
  arriva al **2%** del testo.
- **Il riferimento culturale prima dello stack.** I giornali del 1869 e Floyd-Steinberg per il
  dithering, la fixed-point arithmetic della PlayStation per il jitter. Entrambi trattano **un
  limite hardware storico come materiale espressivo** — che è il frame giusto per qualunque
  effetto di degradazione voluta.

E una mossa da evitare, perché nel corpus è misurabilmente il difetto peggiore: **il primo
elemento in movimento all'88% del testo** (Dithering Shader). Chi mostra subito compra il
diritto a 2.400 parole; chi mostra alla fine non lo compra mai.

---

## 6. I titoli di sezione

Distribuzione reale su **94 titoli unici** del corpus:

| Forma | Quota | Esempi |
|---|---|---|
| **Sintagma nominale** | ~60% | `Fragment Shader`, `Concept`, `Gotchas`, `Normals`, `Implementation Notes`, `Behind the Effect`, `Scan Animation`, `The bloom trick` |
| **Gerundio** | ~25% | `Creating a Custom Postprocessing Effect`, `Implementing Displacement with GPGPU`, `Handling Mouse Movement`, `Suspending Rendering When Not Needed` |
| **Narrativo in prima persona** | ~10% | `Then I wanted ASCII`, `What I learned`, `How Efecto is built`, `Let me hear rigid body talk, body talk` |
| **Imperativo** | **2 su 94** | `Try it`, `1. Create a Flat Plane from InstancedMeshes and Rigid Bodies` |
| **Domanda** | **1 su 94** | `Why Not Use a Texture?` |

Il titolo etichetta **un argomento**, non un'azione. Ma imperativi e domande non sono vietati:
sono **rari e caricati di lavoro**. `Why Not Use a Texture?` è l'unico titolo del corpus che
*pone un problema* invece di annunciare un contenuto, e non è un caso che introduca la sezione
migliore del suo articolo.

Tre dispositivi che valgono il furto:

- **Il prefisso `Optional:`** (`Optional: Integrating with React Three Fiber`) — permesso
  esplicito di saltare, costo zero, onestà massima.
- **I titoli che sono nomi di classe** (`GBufferMaterial`, `ParticleSystem`,
  `MaterialModule`): in un articolo di architettura fanno da indice del codice.
- **I titoli che sono stati di un controllo della GUI** (`Organic Mode On` /
  `Organic Mode Off (Smooth Mode)`): la sezione diventa riproducibile con un click.

Chiusure canoniche: `Final Thoughts` (la più frequente), `Wrap-Up`, `Conclusions`, `Credits`,
`Disclaimer`.

---

## 7. Prosa e codice

Il problema tecnico di questi articoli è uno solo: **20 blocchi di codice senza sembrare un
file sorgente incollato**. Il corpus contiene la soluzione, ed è un insieme di vincoli
meccanici verificabili.

1. **Blocchi piccoli: mediana 9 righe, il 60% sotto le 10.** Il minimo osservato è di 1 riga.
   Sono diff travestiti da snippet.
2. **Mai due blocchi di fila.** In 18 blocchi di una coppia c'è **un solo** caso, e sono i due
   lati della stessa cosa (JS + GLSL). Su 20 blocchi di un'altra, **zero**.
3. **Una frase-puntatore di ~20 parole prima di ogni blocco**, che dica *in quale file e in
   quale punto*: *"Add this at the bottom of the `createVariable` method of the GPGPU:"*
4. **Ogni blocco etichettato col percorso del file, come commento sulla prima riga**:
   ```js
   // core/PhysicsWorld.js (simplified)
   // view/PixelVoxelMesh.js
   // vertex.glsl
   ```
   Con 14 blocchi da 6 file diversi, **l'architettura emerge dai commenti** senza che serva
   una sezione "struttura del progetto". Trucco eccellente e a costo zero.
5. **Nessun blocco è completo.** Si elide con `// ...` e si segnala `(simplified)` quando si è
   riscritto. Il repo linkato in testa è il contratto implicito che rende lecita l'ellissi.
6. **Un solo blocco lungo di consolidamento a metà percorso** — *"Here's the final complete
   vertex shader:"* — per far ri-sincronizzare il lettore. Micro-snippet incrementali per il
   ragionamento, un file intero per la cosa da incollare: è la singola tecnica più preziosa
   emersa dal corpus.
7. **Il perché sta fuori, il cosa sta dentro.** La prosa spiega perché quel blocco esiste; i
   commenti interni segnano cosa fa ogni gruppo di righe, spesso con separatori che fanno da
   sotto-titoli (`// --- Coordinate Transformation (Depth) ---`). **La prosa non ripete mai il
   codice riga per riga.**
8. **Nessun numero magico resta magico.** I pesi di luminanza 0.299/0.587/0.114 vengono
   spiegati con la fisiologia dell'occhio. Se nel tuo shader c'è un `8.0` o un `16.0/17.0`,
   qualcuno vuole sapere da dove viene.

---

## 8. La cadenza visiva

**È la variabile che separa gli articoli buoni dagli altri**, più della struttura e più della
voce.

- **Un elemento visivo ogni 250 parole**, e mai un buco superiore a 500. Il migliore del
  corpus sta a uno ogni 56; il peggiore ha 960 parole consecutive con 5 blocchi di codice e 8
  formule senza un'immagine, ed è il suo tratto più faticoso — proprio dove serviva di più.
- **Il primo elemento in movimento entro le prime 50 parole.** Un video autoplay/loop/muted,
  non uno screenshot.
- **Ogni step ha il suo risultato visivo.** Il difetto più diffuso è mostrare solo il risultato
  finale: nel corpus ci sono un tutorial su un effetto visivo con **zero immagini nel corpo** e
  un articolo sul dithering che non mostra mai la pixelation, il grayscale on/off, né la
  composizione col bloom di cui parla.
- **La coppia A/B affiancata** è il momento in cui si insegna di più con meno parole: due
  sezioni gemelle di 17 e 24 parole, stesso codice, un parametro diverso, due video. Il lettore
  non deve immaginare la differenza, la vede.
- **La demo come elemento visivo a costo zero: nomina il controllo esatto.** *"the "Organic"
  toggle in the GUI"*, *"the "BACK TO PLANE" button"*, *"reducing the "Column" value"*. Cinque
  richiami in 2.200 parole. Invece di produrre sei video in più, deleghi al lettore la
  produzione dell'immagine dandogli il nome del bottone da premere.
- **Le debug view con URL parametrici** (`?normal`, `?outline`, `?outlineColor`) che isolano i
  buffer intermedi sul sito di produzione: insegnano il metodo mentre spiegano il risultato, e
  funzionano a qualunque scala.
- **Metti in scena i tuoi bug.** L'articolo più denso di codice del corpus usa **tre video su
  quattro per mostrare risultati sbagliati**, e ci costruisce sopra la catena *osservazione
  visiva → causa → fix*, ripetuta tre volte: *"The first problem is that the shape of the
  displacement is not a square. This is because…"* Su un effetto glitch, dove "rotto" e
  "voluto" sono visivamente indistinguibili, è la struttura che rende leggibile ogni scelta.

---

## 9. La voce

### Il sistema delle persone

È rigido e vale la pena rispettarlo alla lettera:

| Persona | Uso | Esempio |
|---|---|---|
| **`I`** | ciò che è opinabile: origine, gusto, scelte discutibili | *"I decided to use Rapier"*, *"I intentionally omitted it"*, *"I've kept it simple here"* |
| **`we`** | il lavoro, il meccanismo | *"We'll implement this in three main steps"*, *"we simulate the same ripple effect logic"* |
| **`you`** | percezione, esplorazione, libertà | *"You might notice the second drop feels slightly less intense"*, *"Feel free to play around"* |

**`I` = responsabilità, `we` = lavoro, `you` = percezione.** È ciò che permette a un articolo
di consigli di non suonare né dogmatico né timido, e a un build log di raccontare
un'ossessione personale senza contaminare la parte implementativa.

Nota sui rapporti misurati: nei tutorial il `we` domina (74 contro 24 `you` e 7 `I`), nei
build log l'`I` (38 contro 12 `we` e 3 `you`). Un `we` in un articolo dove l'autore ha già
finito è una convenzione accettata — ma diventa **falso e visibile** quando nel codice compare
una variabile che il "noi" della narrazione non ha mai creato. Se il codice è estratto a
posteriori, o lo riscrivi per l'articolo, o passi all'`I`.

### Tempi

Presente per il comportamento del codice, `we'll` nell'intro, **present perfect per le
ossessioni durature** (*"I've been exploring"*, *"I've long wanted"*), passato riservato alla
biografia del progetto (*"This project started as a side experiment"*).

### Gergo

**Non si definisce mai, si contestualizza.** Nessun articolo del corpus ha un glossario, e
nessuno definisce un termine. Ma quasi ogni termine arriva con la sua funzione attaccata:

> "TypedArrays **for performance**"
>
> "Functions like `clamp` and `smoothstep` **are merely used to clip the values so they don't
> exceed 1.0**"

Il lettore intermedio non si blocca mai. L'unico caso in cui questa regola viene violata nel
corpus è anche il difetto più grave osservato: un articolo intitolato *Building a Real-Time
Dithering Shader* che **elide la matrice di Bayer** con `// ... threshold comparisons based on
matrix position` e non spiega mai il proprio algoritmo centrale.

### Registro

Due registri funzionano, uno solo per articolo:

- **Understatement asciutto**: zero punti esclamativi, zero emoji, zero "amazing", frasi-
  giudizio brevissime (*"This one doesn't."*), e una **frase-firma** che stabilisce il tono da
  sola — *"It's not meant for photorealism. It's for styling and flattening. Think more zine
  than render farm."*
- **Entusiasmo dichiarato**: interiezioni, esclamazioni (*"Not anti-gravity! Just plain
  gravity!"*), autoironia nei titoli, purché accompagnato da **onestà tecnica sui limiti**
  nello stesso pezzo. È la combinazione che regge; l'entusiasmo da solo no.

Frasi da 16 parole mediane, paragrafi da 34, mai più di 3 righe. La densità va **concentrata,
non spalmata**: nel pezzo migliore le due sezioni lunghe sono l'unica cosa lunga in un
articolo di paragrafi da 24 parole.

---

## 10. Come si spiega un concetto difficile

### Regola generale: ancorare, non spiegare per analogia

Il corpus **non usa quasi mai metafore esplicative**. La strategia condivisa è **l'ancoraggio
a un'esperienza già disponibile al lettore**:

> "If this sounds familiar, that's because it is how post-processing works in Three.js."

> "As you saw in the video…"

È la tecnica più trasferibile emersa dall'analisi.

### Il metodo in 7 mosse (per un meccanismo)

Ricavato dalla sezione tecnicamente più difficile del corpus — la sincronizzazione fra vertex
shader e fisica CPU:

1. **Prima il vincolo, formulato come impossibilità.** *"JavaScript has no efficient way to
   detect exactly when this transformation occurs for each instance on the GPU."*
2. **La soluzione in una frase.** *"We simulate the same ripple effect logic on the JavaScript
   side that is running in the vertex shader."*
3. **I due lati affiancati**: 4 righe di GLSL, frase-ponte di 10 parole, 22 righe di JS.
4. **Un mnemonico in grassetto su riga propria**: **Progress – Spread – Noise > Distance**
5. **La domanda che il lettore si sta facendo, posta esplicitamente**, e la risposta per
   eliminazione: *"How can a single JavaScript `if` statement stay perfectly in sync with the
   shader?"* → si dimostra che due cose diverse sono la stessa cosa **togliendo il rumore**
   (`clamp` e `smoothstep` declassati a cosmetica; rimossi, resta un'unica disuguaglianza).
6. **Solo adesso l'algebra**, come *derivazione* e non come premessa, con "Rearranged:" a fare
   da segnale. Matematica da terza media, che **conferma** un'intuizione già data in inglese
   semplice.
7. **Coda onesta** che ammette il costo della soluzione appena venduta.

### Il metodo in 8 mosse (per un'astrazione, quando non hai ancora niente da mostrare)

1. Disambigua i nomi *prima* di definire — *"also known as render-to-texture, FBO compositing
   or multipass rendering"*
2. Definisci per contrasto col comportamento noto
3. Di' subito il beneficio
4. Aggancia a qualcosa che il lettore già fa
5. Un esempio minimo **completo** e auto-commentato
6. Il payoff
7. Prova sociale su progetti reali
8. **Solo allora** il caso personale

Otto mosse in 460 parole, senza un solo elemento visivo, e funziona.

### E la mossa da rubare all'articolo corto

**Una sezione-domanda che difende una scelta contro l'alternativa ovvia.** Struttura:
*cosa fanno gli altri → rifiuto in tre parole → proprietà tecnica in una riga → "which means"
+ conseguenze in lista → chiusura per analogia*. Cinquantadue parole:

> "Some dithering shaders rely on threshold maps or pre-baked noise textures. This one
> doesn't. The matrix pattern is deterministic and screen-space based, which means: [3 bullet]
> It's not meant for photorealism. It's for styling and flattening. Think more zine than
> render farm."

In un articolo corto, **una sola sezione che argomenta invece di descrivere** cambia la
percezione dell'intero pezzo.

---

## 11. La chiusura

- **Non si riepiloga mai.** Nessun "abbiamo visto come". Zero occorrenze nel corpus.
- **L'articolo non finisce mai sul codice.** C'è sempre una sezione para-testuale prima della
  bio.
- **Il template fa i crediti al posto tuo** (tag, box autore, social, articoli correlati), il
  che permette al corpo di finire di colpo senza sembrare mutilo — un articolo del corpus
  chiude in tre parole, *"Thanks for reading!"*, e regge. Ma è anche un'occasione buttata:
  chiudere in tre parole significa rinunciare a dire al lettore cosa può farci adesso.
- **Le varianti vanno nominate, non evocate.** Cinque idee concrete battono un "sperimenta
  pure": cambia il video, usa una foto, voxel di ghiaccio, Voronoi per il vetro rotto, fai
  cadere solo i cubi di un certo colore.
- **Dichiara cosa farai tu dopo.** *"which is exactly what I'm planning to do next"*. È ciò che
  rende l'invito credibile invece che rituale.
- **I crediti sono nominali e generosi.** Nel corpus un autore arriva ad attribuire l'idea
  centrale all'editrice e a **intitolarle l'effetto**.
- **Due articoli su dieci finiscono letteralmente sulla parola "fun".** Il piacere del mestiere
  è la chiusa canonica della casa.

---

## 12. Le assenze sistemiche

Cose che **nessuno** dei dieci articoli ha. Non sono sviste individuali: sono convenzioni, e
vanno rispettate.

- **Nessun indice.** Sostituito dalla catena di verbi in prima frase.
- **Nessun prerequisito, nessun setup, nessun `npm install`, nessuna versione di libreria.**
  Il lettore competente è dato per assunto.
- **Nessun "what you'll learn".**
- **Nessuna sezione "struttura del progetto".** Sostituita dai commenti-percorso nei blocchi.
- **Nessun blocco di codice completo** (tranne il singolo consolidamento di metà articolo).

E una che invece è **un buco, non una convenzione** — anche se la redazione evidentemente lo
tollera, visto che ricorre in tutti e dieci:

> **Nessun numero di performance.** Zero FPS, zero misure, zero prima/dopo. Il corpus dice
> *"quite CPU-intensive"*, *"will hit bottlenecks"*, *"leading to better performance overall"*.
> Un articolo sulle performance senza un solo FPS prima/dopo; un articolo di architettura che
> afferma di ridurre i pass senza contarli.

Chi ha misure vere ha qui un vantaggio competitivo raro: **usa lo stesso slot strutturale
(`Implementation Notes`) e riempilo di numeri**. È il modo più economico per scrivere un pezzo
migliore di tutti e dieci i modelli.

Mancano anche del tutto: mobile, touch, fallback, accessibilità.

---

## 13. Anti-pattern osservati

Difetti reali trovati nel corpus, ciascuno in un articolo pubblicato.

1. **Elidere il proprio concetto centrale.** Un articolo intitolato "Building a Real-Time
   Dithering Shader" che sostituisce l'algoritmo con `// ... threshold comparisons`. Se il
   titolo promette un meccanismo, il meccanismo deve esserci.
2. **Il primo movimento all'88% del testo.**
3. **Zero immagini nel corpo di un articolo su un effetto visivo.** I quattro stati descritti a
   parole corrispondevano letteralmente a quattro GIF mai prodotte.
4. **Non mostrare mai isolato l'effetto che dà il titolo al pezzo** (nessun before/after del
   jitter in tutto l'articolo sul jitter).
5. **Il "we" finto.** Variabili che compaiono nel codice senza essere mai state create nella
   narrazione: tradisce l'estrazione a posteriori.
6. **Affermare guadagni di performance senza un numero.**
7. **Build log senza repo**, con frasi che rimandano a classi che il lettore non può vedere.
8. **Esternalizzare la parte difficile** — *"you can search for one online"* per il noise, cioè
   il pezzo che il lettore non sa fare — e saltare quella dichiarata importante.
9. **Parafrasare il proprio dek** nella prima frase del corpo.
10. **960 parole senza un elemento visivo**, e proprio nella sezione più tecnica.

---

## 14. Checklist finale

Prima di consegnare:

**Struttura**
- [ ] Il genere è dichiarato e coerente (Tutorial / Article / Playground)
- [ ] La prima frase contiene la catena di verbi che è l'indice dell'articolo
- [ ] Lo stack è nominato entro le prime 35 parole
- [ ] Nessun indice, nessun prerequisito, nessuna sezione di setup
- [ ] La coda è tripartita: limiti → varianti → crediti
- [ ] La chiusura non riepiloga

**Numeri**
- [ ] 1.400-2.400 parole (o 400-600 se è un Playground)
- [ ] 8-14 blocchi di codice, mediana 9 righe, nessuno oltre 30
- [ ] Rapporto parole/riga di codice coerente col genere (5-6 tutorial, 9+ article)
- [ ] Paragrafi sotto le 35 parole, frasi intorno alle 16

**Codice**
- [ ] Ogni blocco ha una frase-puntatore che dice file e punto d'inserimento
- [ ] Ogni blocco ha il percorso del file come primo commento
- [ ] Mai due blocchi consecutivi senza prosa in mezzo
- [ ] Un solo blocco lungo di consolidamento, a metà
- [ ] Ogni numero magico è giustificato

**Visivo**
- [ ] Primo elemento in movimento entro le prime 50 parole
- [ ] Un visivo ogni ~250 parole, nessun buco oltre le 500
- [ ] Almeno una coppia A/B affiancata
- [ ] Almeno un video che mostra un risultato **sbagliato**, con la catena osservazione → causa → fix
- [ ] I controlli della demo sono nominati per nome, almeno 3 volte

**Voce**
- [ ] `I` per le scelte opinabili, `we` per il meccanismo, `you` per la percezione
- [ ] Nessun termine definito, ogni termine contestualizzato
- [ ] Una frase-firma che stabilisce il registro
- [ ] Un solo registro per articolo

**Il vantaggio**
- [ ] `Implementation Notes` contiene **numeri veri**, non aggettivi
- [ ] Almeno un "gotcha" che al lettore avrebbe fatto perdere mezza giornata
- [ ] Almeno un'alternativa scartata **con il motivo del rifiuto**

---

## Appendice: i materiali

- `.codrops-research/all-articles.tsv` — indice completo di Codrops, 1.672 articoli
- `.codrops-research/final-10.json` — il corpus selezionato, con verdetti di validazione
- `.codrops-research/articles/*.md` — testo integrale dei 10 articoli
- `.codrops-research/analysis-{A..E}.md` — le cinque analisi di dettaglio, 2 articoli ciascuna
- `.codrops-research/corpus-metrics.json` — metriche strutturali calcolate sul corpus
- `CODROPS-ARTICLE-PROMPT.md` — il prompt operativo che applica questa guideline
