# Found footage — come funzionano davvero quelle camere, e come replicarle in shader

Dossier tecnico per la catena di post-processing di questo progetto (Three.js + `postprocessing`).
Obiettivo estetico: **bodycam / camcorder consumer anni '90-2000**, più CCTV.

**Data:** 2026-08-10 · Numeri verificati contro fonti aperte dove indicato; dove non ho trovato
una fonte lo dichiaro invece di inventare un valore.

> **Cosa di questo documento è finito nel codice.** Il progetto implementa **una sola camera**, la
> bodycam grandangolare: ottica (barrel, aberrazione cromatica laterale, vignettatura, bloom),
> sensore (rolling shutter, rumore agganciato al gain, fixed pattern), automatismi (AE hunting con
> overshoot, AWB drift, AGC), e lato segnale la persistenza del sensore e il chroma bleed.
>
> **Non** implementati, per scelta: tutto ciò che è *diegetico* invece che ottico — timecode e date
> bruciate, REC lampeggiante, ID camera — e gli artefatti di **nastro** (head switching, dropout,
> tracking, timebase jitter, dot crawl, combing) con i relativi preset VHS/Hi8/CCTV. L'obiettivo è
> come la camera *rende* una scena, non una messinscena che dichiara "questa è una registrazione".
> Le sezioni §6, §7 e §11 restano qui come riferimento tecnico, non come descrizione del codice.

---

## Indice

1. [Il principio: cos'è che rende un video "vero"](#1-il-principio)
2. [Le quattro famiglie di camera](#2-le-quattro-famiglie)
3. [Ottica](#3-ottica)
4. [Sensore](#4-sensore)
5. [Automatismi](#5-automatismi--la-parte-che-tradisce-la-simulazione)
6. [Nastro e segnale analogico](#6-nastro-e-segnale-analogico)
7. [OSD](#7-osd)
8. [Movimento della camera](#8-movimento-della-camera)
9. [Catena di post-processing: ordine e motivazione](#9-catena-di-post-processing)
10. [Incompatibilità reciproche](#10-incompatibilità-reciproche)
11. [Preset](#11-preset)
12. [Fonti](#12-fonti)

---

## 1. Il principio

Il realismo del found footage **non sta negli artefatti gravi**, sta in due cose che quasi tutte le
simulazioni sbagliano:

1. **Gli automatismi che inseguono.** Una camera vera non ha un'esposizione corretta: ce l'ha
   *in ritardo*. Entra in un corridoio scuro e per un secondo l'immagine resta nera, poi il gain
   sale, poi supera il bersaglio e schiarisce troppo, poi rientra. È la firma più riconoscibile
   in assoluto e costa pochissimo implementarla.
2. **La coerenza della catena.** Ogni artefatto sta in un punto preciso fra la luce e il file.
   Il rumore del sensore viene *prima* della compressione, quindi il codec lo comprime e i
   macroblocchi respirano insieme al rumore. Se aggiungi il grano alla fine, l'occhio lo legge
   subito come un filtro sovrapposto.

Corollario: meglio pochi artefatti nell'ordine giusto che tutti insieme.

---

## 2. Le quattro famiglie

| | Sensore | Risoluzione reale | Compressione | Firma visiva |
|---|---|---|---|---|
| **VHS/VHS-C** (1985-2000) | CCD | ~240-250 linee orizzontali | nastro analogico | head switching, chroma bleed enorme, dropout |
| **Video8 / Hi8** (1989-2000) | CCD | 240 (Video8) / 400 (Hi8) linee | nastro analogico | come sopra ma più pulito; nightshot IR |
| **CCTV** (1995-2005) | CCD → CMOS | 330-540 TVL | CVBS, poi MJPEG | 4:3, fps basso, timestamp bruciato, IR notturno |
| **Bodycam** (2010+) | CMOS | 720p/1080p | H.264 bitrate basso | fisheye, rolling shutter, macroblocchi sul movimento |

**Numeri verificati** (Wikipedia Hi8, freevideoworkshop, transfervideotapes):
- Luma VHS: portante FM **3,4-4,4 MHz**. Video8: 4,2-5,4 MHz (banda 1,2 MHz).
  Hi8: **5,7-7,7 MHz** (banda 2,0 MHz).
- **Chroma: 0,3 MHz per Hi8, 0,4 MHz per S-VHS.** Hi8 non ha aumentato la banda chroma rispetto
  a Video8: è per questo che il colore resta "molle" anche sui formati migliorati.
- Risoluzione orizzontale: VHS ~250 linee, Video8 240, Hi8 e S-VHS 400.

**La conseguenza implementativa più importante di tutto il documento**: il rapporto fra banda luma
e banda chroma è di circa **10:1**. Il colore ha letteralmente un decimo del dettaglio della
luminanza. Non è chroma subsampling 4:2:0 (fattore 2), è molto più violento. Vedi §6.

---

## 3. Ottica

| Artefatto | Causa | Simulazione | Valori |
|---|---|---|---|
| **Barrel distortion** | grandangolari corti, lenti economiche | `uv' = c + d·(1 + k1·r² + k2·r⁴)` | bodycam k1 ≈ 0,15-0,35; camcorder 0,03-0,08; CCTV 0,10-0,25 |
| **Aberrazione cromatica laterale** | indice di rifrazione dipendente da λ | campiona R e B a scale radiali leggermente diverse | 0,15-0,6 px al bordo, **zero al centro** |
| **Vignettatura** | cos⁴ + ostruzione meccanica | `1 - v·pow(r, 2.5)` | 0,15-0,45 |
| **Glare / veiling** | sporco e graffi sulla lente | bloom largo e sporco sulle alte luci | soglia ~0,75 |

Nota: l'aberrazione cromatica **deve** essere nulla al centro e crescere col raggio. Uno shift RGB
costante su tutto il frame è l'errore da principiante che rende tutto finto.

**Per il grandangolo di una bodycam la strada giusta non è la distorsione in post**: è alzare il
FOV della camera 3D (100-120°) e aggiungere solo una barrel leggera. Distorcere in post un render
a 50° dà un'immagine "zoomata e curvata", non un grandangolo.

---

## 4. Sensore

### CCD — vertical smear
Durante la lettura, la carica viene traslata riga per riga attraverso i registri di trasferimento
verticali fino al registro di uscita. Se un pixel è saturo, la carica **filtra nel registro
verticale** e viene trascinata lungo tutta la colonna: una **striscia verticale luminosa che
attraversa l'intera immagine** sopra e sotto la sorgente di luce. È la firma inconfondibile delle
camere a CCD (fonte: Teledyne Vision Solutions, TV Tech).

Simulazione: per ogni colonna, somma la luminanza dei pixel sopra soglia e aggiungi il risultato
all'intera colonna, pesato. Costa un blur verticale monodirezionale.

### CMOS — rolling shutter
Le righe vengono esposte e lette in sequenza; l'ultima riga è in ritardo rispetto alla prima
(fonte: arXiv 2101.10011, GitHub horshack-dpreview/RollingShutter). Conseguenze:
- **skew**: pan orizzontale → il frame si inclina a parallelogramma
- **wobble/jello**: vibrazione → ondeggiamento
- **partial exposure**: un flash illumina solo una fascia di righe

Simulazione: `uv.x += skew · (uv.y - 0.5)` dove skew è proporzionale alla velocità orizzontale
della camera. Readout tipico di un sensore consumer: **8-30 ms** per frame intero.

### Rumore
- Cresce con il **gain**, non con il tempo: è il legame che rende credibile una scena buia.
- Il **canale blu è sempre il peggiore** (meno fotoni utili, più amplificazione).
- **Fixed pattern noise**: una componente che *non* cambia da frame a frame. Mescolarne un 20-30%
  al rumore temporale è ciò che distingue un sensore vero dal `random()` per frame.

### IR / nightshot
Il filtro IR-cut è meccanico: di notte si sposta. Il sensore diventa di fatto monocromatico e
sensibile all'infrarosso, per cui la vegetazione diventa bianca e gli occhi brillano. Le camere
Sony rendevano il tutto in **verde**; le CCTV in **grigio**.

---

## 5. Automatismi — la parte che tradisce la simulazione

**AE hunting / exposure pumping.** L'auto-esposizione è un anello di controllo con ritardo. Modello
minimo che funziona: esposizione target dalla luminanza media del frame, inseguita con una costante
di tempo di **0,3-0,8 s** e un **overshoot** del 10-25%. Il risultato — l'immagine che si scurisce
troppo, poi rimbalza — è il singolo effetto che più fa dire "è vero".

**AGC.** Quando l'esposizione sale, **il rumore deve salire con lei**. Se aumenti la luminosità
senza aumentare il rumore, l'occhio non ci crede. Questo accoppiamento è obbligatorio.

**AWB drift.** Il bilanciamento del bianco deriva lentamente e ogni tanto scatta, soprattutto
quando entra in campo una sorgente di luce diversa. Deriva di ±0,05-0,1 in temperatura colore
normalizzata, con salti occasionali.

**Autofocus hunting.** Il contrast-detect non sa da che parte andare: sfoca, misura, corregge,
supera, torna. Accade sui cambi di soggetto e in poca luce.

**Bitrate breathing.** In H.264 a bitrate fisso, una scena che si muove esaurisce il budget e i
macroblocchi diventano visibili. Nel nostro progetto questo è già coperto dall'effetto datamosh:
basta pilotarne l'intensità con la quantità di movimento.

---

## 6. Nastro e segnale analogico

**Head switching noise.** È la firma del VHS. Le testine vengono accese quando passano sul nastro e
spente subito dopo per non mostrare rumore; l'intervallo di commutazione cade **appena prima del
sync verticale**, cioè **in fondo al frame** (fonte: AV Artifact Atlas). Sono ~8-10 scanline di
disturbo con uno **strappo orizzontale** della porzione inferiore. Non è un difetto riparabile:
c'è **sempre** in una digitalizzazione da nastro non croppata. Sui televisori CRT era nascosta
dall'overscan — motivo per cui la ricordiamo poco pur avendola guardata per vent'anni.

**Chroma bleed.** Vedi i numeri del §2: la crominanza ha ~1/10 della banda della luminanza.
Simulazione corretta: converti in YIQ/YCbCr, **sfoca i canali di crominanza solo orizzontalmente**
con un kernel largo (10-20 px su 640), lascia la luminanza intatta. Aggiungi un **ritardo
chroma/luma** di 1-3 px, che è il colore spostato a destra rispetto ai contorni.

**Dropout.** Perdita di contatto testina-nastro: righe orizzontali **bianche o nere**, lunghe da
pochi pixel a mezza riga, di durata 1-2 frame.

**Tracking error.** Righe di rumore che scorrono verticalmente, tipicamente in una fascia; nei casi
peggiori l'immagine si spezza in due con uno strappo orizzontale.

**Combing da interlacciamento.** Due campi catturati a 1/50 s di distanza, mostrati insieme: sui
bordi in movimento appaiono i **denti di pettine** sulle righe alterne. Simulazione: sulle righe
dispari campiona il frame precedente (serve un buffer del frame precedente), sulle pari il
corrente. L'effetto compare **solo dove c'è movimento**, quindi va pesato con la magnitudine del
moto — nel nostro progetto il velocity buffer ce l'abbiamo già.

**Dot crawl / cross-colour.** Nel composito luma e chroma condividono la banda: i pattern fini
vengono interpretati come colore e viceversa. Si vede come puntini che strisciano lungo i bordi
verticali ad alto contrasto e iridescenze sui tessuti a righe.

**Timebase jitter.** Instabilità meccanica: ogni scanline è spostata orizzontalmente di una
frazione di pixel in modo casuale. Piccolissimo (0,5-2 px) ma è ciò che dà l'"instabilità" del
nastro. In alto il primo gruppo di righe può piegarsi (*flagging*).

---

## 7. OSD

Regola: **l'OSD è inciso dopo tutto**, quindi non subisce né distorsione ottica né rumore né
compressione. Deve essere perfettamente nitido e allineato ai pixel. Un timecode che si deforma con
la lente è il modo più veloce per rovinare l'illusione.

| | Posizione | Formato | Note |
|---|---|---|---|
| Camcorder anni '90 | in basso a dx, a volte in alto | `12 25 1999` / `10:32:45 PM` | cifre a **7 segmenti**, spesso arancioni o bianche |
| Camcorder 2000 | in basso | `2004-11-03 22:14:07` | font bitmap più fine |
| CCTV | in alto a sx (ID camera) + in alto a dx (data) | `CAM 03` + `2001-08-14 03:12:55` | monospazio bianco con ombra nera |
| Bodycam | in basso | `AXON BODY 3  2015-06-12 14:02:11` | sans-serif, spesso con ID agente |

**REC**: pallino rosso lampeggiante, tipicamente **0,5-1 Hz** (un lampeggio al secondo).
Non ho trovato una fonte che standardizzi la frequenza: è una convenzione, non una specifica.

Le cifre a 7 segmenti si disegnano proceduralmente in GLSL senza alcun asset: 7 rettangoli e una
maschera di bit per cifra.

---

## 8. Movimento della camera

Fonti (physiological camera shake model, Videomaker): la banda del tremolio è **1-10 Hz**, con
ampiezze **maggiori alle basse frequenze**. Il tremore fisiologico mano-braccio sta a **3-5 Hz**.

Modello pratico a tre componenti:
- **deriva lenta** 0,2-0,5 Hz, ampiezza grande — il non riuscire a tenere ferma l'inquadratura
- **tremore** 3-5 Hz, ampiezza media
- **micro-jitter** 8-12 Hz, ampiezza piccola — sparisce con la stabilizzazione ottica

Per una **bodycam** aggiungi il **bob del passo**: verticale a ~2 Hz (cadenza di camminata), con una
componente laterale a metà frequenza. Il bob si accoppia col rolling shutter e produce il jello.

Per **CCTV**: nessun tremolio, ma **frame rate basso** (4-12 fps) ottenuto duplicando i frame, il
che dà lo stutter caratteristico.

---

## 9. Catena di post-processing

Ordine, e il perché di ciascun passaggio:

```
1. SCENA 3D                  FOV largo per bodycam (100-120°), non distorsione in post
2. OTTICA                    barrel + CA laterale        prima di tutto: è la luce che entra
3. SENSORE                   rolling shutter / CCD smear, rumore gain-dipendente
4. AUTOMATISMI               AE hunting, AWB drift        (agiscono sul sensore, non sul nastro)
5. COMPRESSIONE              ← il datamosh esistente      comprime rumore e artefatti già presenti
6. NASTRO / SEGNALE          chroma bleed, combing, head switching, dropout, jitter, dot crawl
7. VIGNETTATURA + GRANA      residuo di visualizzazione
8. OSD                       inciso per ultimo, mai distorto
```

Il punto 5 è la ragione per cui la catena va spezzata in **due pass** attorno al datamosh esistente,
invece di essere un unico effetto messo in fondo.

**Trade-off noto**: distorcendo la geometria al punto 2 si disallineano il velocity buffer e il
depth buffer, che il datamosh usa e che non sono distorti. Con k1 modesto (≤0,2) lo scarto è di
pochi pixel ai bordi e si confonde con l'errore di predizione che il datamosh simula comunque. Per
un fisheye vero conviene alzare il FOV della camera invece di aumentare k1.

---

## 10. Incompatibilità reciproche

Da rispettare per avere preset coerenti:

- **CCD smear ⊗ rolling shutter** — sono due tecnologie di sensore diverse. Mai insieme.
- **Head switching / dropout / tracking ⊗ bodycam** — sono artefatti di *nastro*. Una bodycam
  digitale non li ha. Su una bodycam gli artefatti sono macroblocchi e rolling shutter.
- **Combing ⊗ progressivo** — il combing esiste solo su sorgente interlacciata (VHS, Hi8, CCTV
  analogica). Una bodycam moderna registra progressivo.
- **Dot crawl ⊗ S-VHS / Hi8 via S-Video / digitale** — nasce dal composito, dove luma e chroma
  condividono la banda. Se il segnale è a componenti separate, non c'è.
- **Colore ⊗ nightshot** — in IR il sensore è monocromatico: niente chroma bleed, niente dot crawl.

---

## 11. Preset

| Parametro | VHS-C 1994 | Hi8 nightshot | CCTV 2001 | Bodycam 2015 |
|---|---|---|---|---|
| FOV camera | 55° | 55° | 75° | 105° |
| Barrel k1 | 0,05 | 0,05 | 0,18 | 0,28 |
| Aberrazione cromatica | 0,35 | 0,10 | 0,25 | 0,45 |
| Vignettatura | 0,30 | 0,40 | 0,25 | 0,35 |
| Sensore | CCD smear 0,6 | CCD smear 0,8 | CCD smear 0,3 | rolling shutter 0,5 |
| Rumore (base) | 0,05 | 0,22 | 0,08 | 0,04 |
| Fixed pattern | 0,25 | 0,35 | 0,30 | 0,15 |
| AE hunting | 0,6 | 0,9 | 0,3 | 0,7 |
| AWB drift | 0,4 | 0 (mono) | 0,2 | 0,3 |
| Chroma bleed | 0,85 | 0 (mono) | 0,55 | 0,15 |
| Combing | 0,7 | 0,6 | 0,5 | 0 |
| Head switching | 0,9 | 0,7 | 0 | 0 |
| Dropout | 0,5 | 0,3 | 0 | 0 |
| Timebase jitter | 0,7 | 0,5 | 0,2 | 0 |
| Dot crawl | 0,6 | 0 | 0,4 | 0 |
| Monocromo / tinta | — | verde IR | — | — |
| Frame rate | 25 | 25 | 8 | 30 |
| OSD | `12 25 1994` 7-seg | `10:32:45` 7-seg | `CAM 03` + data | `2015-06-12` + REC |
| Shake | handheld medio | handheld forte | nessuno | bob del passo |

---

## 12. Fonti

Aperte e verificate durante la stesura:

- [AV Artifact Atlas — Head Switching Noise](http://www.avartifactatlas.com/artifacts/head_switching_noise.html) — meccanismo della commutazione testine e posizione prima del sync verticale
- [Hi8 — Wikipedia](https://en.wikipedia.org/wiki/Hi8) — portanti FM, banda luma/chroma, risoluzione
- [Hi8 Video Wiki — Free Video Workshop](https://www.freevideoworkshop.com/hi8-video-wiki-sony-hi8-format-explained/) — confronto banda VHS/Hi8
- [Difference between Video8 and Hi8](https://transfervideotapes.com/difference-between-video-8-and-hi8-tapes/) — linee di risoluzione
- [Teledyne Vision Solutions — Vertical bleeding/smearing](https://www.teledynevisionsolutions.com/support/support-center/troubleshooting/iis/vertical-bleeding-or-smearing-from-a-saturated-portion-of-an-image/) — meccanismo dello smear nei registri verticali
- [TV Tech — CCD and CMOS](https://www.tvtechnology.com/news/ccd-and-cmos) — smear assente nei CMOS, skew/wobble/partial exposure
- [They See Me Rollin' (arXiv:2101.10011)](https://arxiv.org/pdf/2101.10011) — lettura riga per riga e ritardo dell'ultima riga
- [RollingShutter — misure di readout](https://github.com/horshack-dpreview/RollingShutter) — tempi di readout misurati per sensore
- [A physiological camera shake model (ResearchGate)](https://www.researchgate.net/publication/241634023_A_physiological_camera_shake_model_for_image_stabilization_systems) — banda del tremolio
- [Videomaker — Curing Camera Shake](https://www.videomaker.com/article/f6/1413-curing-camera-shake-your-guide-to-image-stabilization/) — 1-10 Hz, tremore 3-5 Hz
- [VideoHelp — Head switching noise](https://forum.videohelp.com/threads/255368-Head-switching-noise) — conferma pratica dalla community di restauro

**Non verificato con fonte primaria** e segnalato come tale nel testo: la frequenza di lampeggio
del REC (convenzione, non specifica), i coefficienti k1/k2 per modello di bodycam specifico, i
tempi esatti di risposta dell'AE per un dato camcorder.
