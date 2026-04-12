# Maze Of Mages – Projektdokumentation

**Stand:** 2026-04-12 (aktualisiert, Session 5)
**Pfad:** `/home/admin/Labyrinth/` — Git-Repo, Entwicklung und Live-Version (Apache zeigt direkt hierher)
**Erreichbar unter:** `http://localhost:4000` — Apache-VirtualHost, startet automatisch mit dem System.
**Online (GitHub Pages):** `https://JanDrescher.github.io/Labyrinth/` — wird automatisch aktualisiert bei jedem Push auf `main`.

**Server-Setup:** Apache2 auf Debian mit zwei VirtualHosts:
- Port 80 → `/var/www/wordpress` (WordPress)
- Port 4000 → `/home/admin/Labyrinth` (dieses Projekt)
- Config: `/etc/apache2/sites-enabled/labyrinth.conf`

**JS-Struktur:** Drei separate ES-Module (`maze.js`, `player.js`, `game.js`), eingebunden via `<script type="module" src="js/game.js">`. Funktioniert über HTTP — nicht über `file://`.

---

## Dateistruktur

```
Labyrinth/
├── server.js          Node.js HTTP-Server (port 4000, keine npm-Abhängigkeiten)
├── index.html         Hauptseite
├── css/
│   └── style.css      Layout, Themes, Slider-Styling, Mobile-Media-Query
├── img/
│   ├── mage-s/n/e/w.png   Spieler-Sprites (4 Richtungen, je 4 Walk-Frames)
│   ├── spell-sprite.png   Spell-Icons Spritesheet (1376×768, 5×2 Grid, 10 Spells)
│   ├── npc1.png           NPC1-Sprite (blauer Energie-Orb, 6 Frames, 2544×416 px)
│   ├── npc2.png           NPC2-Sprite (goldener Stern, 6 Frames, 2544×416 px)
│   ├── npc3.png           NPC3-Sprite (grüner Schleim-Geist, 6 Frames, 2544×416 px)
│   └── portal9.png        Portal-Sprite für Leuchtfeuer-Beacon (7 Frames, echte Transparenz)
└── js/
    ├── maze.js        Labyrinth-Generator, Renderer, BFS-Löser, Dead-End-Erkennung
    ├── player.js      Spieler: Bewegung, Kollision, Darstellung, visitedCells, phasing
    └── game.js        Game-Loop, Kamera, Fog-of-War, Spells, Items, Beacons, UI, Touch, NPCs
```

---

## server.js

Minimaler HTTP-Dateiserver ohne externe Abhängigkeiten.

- Lauscht auf `0.0.0.0:4000`
- Bedient statische Dateien relativ zu `__dirname`
- Directory-Traversal-Schutz via `path.startsWith(ROOT)`-Check
- MIME-Types: `.html`, `.js`, `.css`, `.png`, `.ico`

---

## index.html

Struktur der Seite (von oben nach unten):

```
<h1>           Titel "Maze Of Mages"
#settings      Schieberegler-Panel (5 Regler + Level-Jump) — standardmäßig versteckt
#hud           Timer, Punkte, Level, Buttons (Buttons standardmäßig versteckt)
#canvas-wrap   Spielfeld-Container (flex, nimmt restlichen Raum ein)
  #spell-bar   Spell-Leiste (Desktop: oben; Mobil: Overlay am unteren Canvas-Rand)
  <canvas>     Spielfeld
  #overlay     Start-/Gewinn-Overlay
<p#hint>       Tastatur-Hinweis (auf Mobilgeräten ausgeblendet)
```

### Schieberegler (`#settings`) — standardmäßig versteckt

| ID          | Label              | Min | Max | Default | Wirkung                            |
|-------------|--------------------|-----|-----|---------|-------------------------------------|
| `inp-cols`  | Spalten            | 5   | 80  | 21      | Maze neu generieren (on `change`)   |
| `inp-rows`  | Zeilen             | 5   | 80  | 21      | Maze neu generieren (on `change`)   |
| `inp-cell`  | Gangbreite (px)    | 4   | 80  | 80      | Maze neu generieren (on `change`)   |
| `inp-fog`   | Sichtweite (px)    | 15  | 400 | 120     | Nur Lichtkegel-Radius, kein Rebuild |
| `inp-fade`  | Überblendung (px)  | 0   | 200 | 150     | Nur Fade-Breite, kein Rebuild       |

Admin-UI ein-/ausblenden: Tastensequenz **q → w → e → r → t** (Toggle).
Im Admin-Panel zusätzlich: **Level-Jump** — Zahlenfeld + "Go"-Button. Setzt `_level`, passt Maze-Größe an (21 + (level−1)×2, max 80) und startet neu.

### HUD

```
Zeit  [0.0 s]  Punkte [0]  Level [1]  Items [0]  [Neues Labyrinth*]  [Lösung zeigen*]  [Spells +10*]
```
`*` standardmäßig versteckt, via qwert einblendbar.

- **Punkte:** +10 pro Item, +20 Basis, +50 Zeitbonus pro gelöstem Labyrinth
- **Level:** startet bei 1, +1 bei jedem gelösten Labyrinth
- **Items:** verbleibende Items auf der aktuellen Map (`#items-left`), wird bei Pickup dekrementiert
- **Spells +10:** Debug-Button — gibt allen 10 Spells je 10 Ladungen, markiert alle als entdeckt (ignoriert minLevel)

---

## js/maze.js — Klasse `Maze`

### Konstruktor `new Maze(cols, rows, cell)`

- Erstellt `walls[r][c] = { N, E, S, W }` — `true` = Wand vorhanden
- **Hinweis:** Ungerade Spaltenanzahl (z.B. 21) → symmetrisches Labyrinth (Eingang/Ausgang mittig)
- `mid = Math.floor(cols / 2)`

### `_generate()` — Recursive Backtracker (DFS)

Stack-basierter DFS, erzeugt **perfektes Labyrinth** (keine Schleifen).

### `draw(ctx)` — Path-based Renderer

Wandstärke `W = Math.max(3, Math.round(cell * 0.15))`.
Ansatz: Boden zuerst flächig füllen (`_makeFloorPattern`), dann Wände als gestrichelte Liniensegmente darüber (`_makeWallPattern`, `lineWidth = 2W`, `lineCap = 'round'`). Jede Wand wird genau einmal gezeichnet (N + W pro Zelle, dann Süd- und Ostrand). Runde Linienenden erzeugen organisch wirkende Wandabschlüsse.
Beide Pattern-Texturen nutzen Läuferverband; die geteilten Hälften an der Kachelgrenze unterdrücken innere Kanten-Highlights/-Schatten um Nahtartefakte zu vermeiden.

### `drawSolution(ctx, alpha = 0.75)`

BFS-Kürzester-Pfad, rote Linie, alpha-steuerbar.

### `drawDeadEnds(ctx, visitedCells, knownDeadCells, playerCx, playerCy, fogRadius, alpha = 1)`

- BFS läuft **immer** (unabhängig von alpha) → aktualisiert `knownDeadCells`
- Zeichnet Sackgassen mit `rgba(18,14,32,0.78) × alpha`

---

## js/player.js — Klasse `Player`

```
_cx, _cy        Pixelposition (float)
_speed          3 px/Frame
_facing         'N'|'S'|'E'|'W'
_animFrame      0–3 — aktueller Walk-Frame
_animT          Timestamp letzter Frame-Wechsel
_moving         boolean — ob Tasten gedrückt sind
phasing         boolean — wenn true, werden interne Wandkollisionen ignoriert (Geist-Spell)
visitedCells    Set<number> — betretene Zellen (row*cols+col)
knownDeadCells  Set<number> — erkannte Sackgassen
```

**Kollision:** AABB, Hitbox `hw = cell/2 - 1`. Bei `phasing = true` werden interne Wände ignoriert.
**Außenwände:** Ost- und Westrand blockieren immer (auch bei phasing). Südrand blockiert immer. Nordrand bleibt offen (Zielerkennung `_cy < 0`).
**Startposition:** `((mid + 0.5) * cell, (rows - 0.5) * cell)`

**Sprite:** Vier separate Dateien mit je 4 Walk-Frames horizontal, transparenter Hintergrund:
- `img/mage-s.png` (1945×528), `img/mage-n.png` (1945×528), `img/mage-w.png` (1945×528), `img/mage-e.png` (1456×396)

Frame-Wechsel alle 150 ms bei Bewegung, Frame 0 im Stand. Gezeichnet in Screengröße `cell × 0.80`. Keine Rotation — jede Datei zeigt die native Blickrichtung. Robe-Farbe per HSL-Hue-Substitution (`robeColor`-Property, hex oder hsl-String); zufälliger Farbton beim ersten Start, bleibt für die gesamte Spielsitzung konstant (gespeichert in `Game._robeColor`).

---

## js/game.js — Klasse `Game`

### Spell-System

`SPELL_DEFS` — 10 Slots (Index 0–9 = Taste 1–0). Alle Spells starten mit `initialCount: 0`. Jeder Spell muss erst als Item im Labyrinth gefunden werden. Die Verfügbarkeit als Item ist level-gestaffelt (`minLevel`).

| Slot | Taste | Name        | Dauer | minLevel | itemDiv | Farbe     | Beschreibung |
|------|-------|-------------|-------|----------|---------|-----------|--------------|
| 0    | 1     | Pfad        | 5 s   | 1        | 10      | `#4dd0e1` | Lösungspfad anzeigen, Fade ab 2 s |
| 1    | 2     | Sackgasse   | 20 s  | 1        | 5       | `#66bb6a` | Sackgassen ausgrauen, Fade ab 3 s |
| 2    | 3     | Sprung      | 5 s   | 2        | 8       | `#ff7043` | Kamera zoomt organisch raus (sin-Kurve), überspringt Feinde; Spieler immun gegen NPCs |
| 3    | 4     | Pforte      | 5 s   | 3        | 9       | `#a1887f` | Eine Wand in Blickrichtung öffnen; NPCs können die Pforte nicht nutzen |
| 4    | 5     | Geist       | 6 s   | 4        | 9       | `#ba68c8` | Spieler kann interne Wände durchqueren (Außenwände blockieren weiterhin); Spieler immun gegen NPCs |
| 5    | 6     | Teleport    | —     | 5        | 6       | `#ffab40` | Erstes Auslösen: Portal A + Sofort-Teleport zu zufälligem Punkt (1 Ladung). Zweites Auslösen: Portal B + Sofort-Rückkehr zu A (kostenlos). Danach: 3 Sek. auf Portal stehen → Teleport zum anderen. Gegner können Portale nicht nutzen. Pending-Portal blinkt im Slot. |
| 6    | 7     | Orakel      | 4 s   | 6        | 9       | `#fff176` | Fog komplett entfernen |
| 7    | 8     | Pfadmitte   | —     | 7        | 10      | `#ffd54f` | Teleport zur Mitte des kürzesten Lösungspfades |
| 8    | 9     | Waffe       | —     | 8        | 8       | `#e53935` | (Effekt folgt) |
| 9    | 0     | Schild      | —     | 9        | 10      | `#42a5f5` | (Effekt folgt) |

**Spell-Counts** werden nicht zwischen Leveln zurückgesetzt.
**Aktivierung:** Tasten 1–0 (Desktop) oder Tap auf Spell-Slot (Mobil). Interner Helper `_triggerSpell(idx)`.

### Discovery-System (Erstfund-Overlay)

Wird ein Spell zum allerersten Mal aufgesammelt, pausiert der Timer und ein halbtransparentes Canvas-Overlay erscheint mit:
- Zeile 1 (klein): "Du hast einen neuen Spell gefunden:"
- Zeile 2 (groß, farbig): Spell-Name
- Zeile 3: Beschreibungstext (word-wrapped)
- OK-Button (Spell-Farbe) — schließt per Klick, Tap oder Enter

`_discoveredSpells: Set<number>` — persistiert über Level hinweg. Einmal gesehen → kein Overlay mehr.

**Mobil-Positionierung:** Auf Touch-Geräten wird `by` so gesetzt, dass der untere Rand des Overlays mit 16 px Abstand über der Oval-Oberkante liegt (`vh*0.70 − ry − boxH − 16`), mind. 8 px vom oberen Rand.

**Timer-Pause:** `_pausedMs` + `_pauseStart` — während Discovery läuft der Timer nicht. `_elapsedMs()` subtrahiert die gesamte Pausezeit. Wirkt sich auch auf Zeitbonus-Berechnung aus.

### Item-System

Items pro Labyrinth: `Math.max(1, floor(√(cols×rows) / itemDiv))` pro Spell.
Nur Spells mit `minLevel <= this._level` erhalten Items im aktuellen Level.
Aufnahme durch Drüberlaufen → +1 Ladung + **10 Punkte** + Score-Flash-Animation.

**Pickup-Animation:** Beim Aufsammeln erscheint das Sprite kurz skaliert (bis 1,7×) und blendet über 480 ms aus (`_itemPickups`-Array, world space).

Darstellung: Spell-Sprite aus `img/spell-sprite.png` in Originalproportionen, langsam pulsierend.

**Item-Respawn:** Jedes aufgesammelte Item erscheint nach einer Wartezeit an einer zufälligen freien Zelle neu (nicht Eingang, nicht Ausgang, nicht auf bestehenden Items). Wartezeit: `level × 60s × 1.5^(n−1)`, wobei `n` = wie oft dieser Spell-Typ bisher eingesammelt wurde. `_pickupCounts` persistiert über Level-Wechsel. `_pendingRespawns` wird bei Level-Wechsel geleert.

**Spell-Sprite-Sheet:** `img/spell-sprite.png` — 1376×768 px, 5 Spalten × 2 Reihen. Sprite-Index entspricht Spell-Index (0–9, zeilenweise von links oben).

### Punktevergabe

- **+10** pro aufgesammeltem Item (sofort, mit Score-Flash)
- **+20** beim Lösen eines Labyrinths
- **+50 Zeitbonus** wenn `Zeit < (cols−1)×(rows−1)/2` Sekunden (pausierte Zeit zählt nicht)
- Overlay zeigt `(+20)` bzw. `(+20 +50 Zeitbonus)` in grün
- **Score-Flash:** `#score` skaliert kurz auf 1,45× und leuchtet goldgelb auf (CSS-Keyframe, 420 ms)

### Level-Progression

Bei jedem gelösten Labyrinth: Level +1, Spalten/Zeilen +2 (max 80), Sichtweite +5 px (max 400).

### Admin-UI

Tastensequenz **q→w→e→r→t** togglet: Settings-Panel + "Neues Labyrinth" + "Lösung zeigen" + "Spells +10".
**Level-Jump:** Zahlenfeld + "Go" im Settings-Panel — springt direkt zu einem Level, passt Maze-Größe an.
Standard: versteckt. **Enter** startet nächstes Labyrinth wenn Win-Overlay sichtbar.

### Kamera & Zoom

Desktop: `psy = vh/2` — Spieler in Bildschirmmitte.
Mobil: `psy = vh * 0.40` — Spieler im oberen Bereich, Platz für Steuer-Oval unten.

Normale Ansicht: `ctx.translate(Math.round(vcx-px), Math.round(psy-py))`
Sprung-Spell: `ctx.translate(vcx, psy); ctx.scale(zoom,zoom); ctx.translate(-px,-py)`
Zoom-Kurve: `zoom = 1 − 0.55 × sin(π × progress)` (0→1 über 5s).

**Spieler wird außerhalb des Zoom-Transforms gezeichnet** → bleibt bei Sprung immer gleich groß.
Fog-Zentrum folgt `psy` (nicht fester Bildschirmmittelpunkt).

### Fog-of-War (`_drawFog`)

Offscreen-Canvas-Ansatz mit `destination-out` für mehrere Lichtquellen:
1. Offscreen-Canvas mit Fog-Farbe füllen
2. Per `punchLight()` transparente Löcher einschneiden (Spieler + Beacons)
3. Ergebnis mit `fogMult` (0–1) auf Hauptcanvas zeichnen

`fogMult = 1 − orakelAlpha` → Orakel-Spell blendet Fog aus.

### Teleport-System (Spell 6)

- `this._portalPairs = [{ a: {cx,cy,animFrame,animT}, b: {...}|null }, ...]` — Paare aus je 2 Portalen
- `this._portalStandStart = { pi, key:'a'|'b', startedAt }|null` — Stand-Timer für Portal-Nutzung
- Reset bei `_startNew()`
- **Aktivierung:** 1. Auslösung (1 Ladung) → Portal A an Spielerposition + Sofort-Teleport zu zufälliger Zelle. 2. Auslösung (kostenlos) → Portal B an aktueller Position + Sofort-Rückkehr zu Portal A. 3. Auslösung → neues Paar (kostet 1 Ladung).
- **Nutzung:** 3 Sekunden auf vollständigem Portal stehen → Teleport zum Partner. Nur Drüberlaufen = nichts.
- **Fortschrittsanzeige:** goldener Bogen um das Portal, füllt sich über 3 Sek. (world space)
- **Pending-Anzeige:** Spell-Slot 6 pulsiert orange (`portal-pending-pulse`, 0,8-Sek.-Zyklus) solange Portal A wartet
- **Gegner:** können Portale nicht auslösen
- **Fog-Ausleuchtung:** 25% (`fc.globalAlpha = 0.25`) — Portale leicht durch Nebel sichtbar
- **Visuell:** animiertes Portal-Sprite (`img/portal9.png`, 7 Frames, 120 ms/Frame, Größe `cell × 0.6375`); pending Portal A pulsiert in Deckkraft
- **Mini-Map:** orangefarbene Dots; pending Portal A blinkt

### NPC-System

- `this._npcs = [{ cx, cy, row, col, targetCx, targetCy, animFrame, animT, lastDir, spriteIndex, speed, mode, chaseLostAt, cooldownUntil }, ...]`
- Spawn bei `_startNew()` via `_spawnNpcs()` — 3 NPCs ab `NPC_MIN_LEVEL = 1`, je verschiedene Startposition
- **Konfiguration** via `NPC_DEFS` (Konstante am Dateianfang):

| # | Sprite | Speed | Glow | Alpha | bgTol | Mini-Map |
|---|--------|-------|------|-------|-------|----------|
| NPC1 | blauer Energie-Orb | 1.5 px/F | blau, 18 | 1.0 | 50 | `#4fc3f7` |
| NPC2 | goldener Stern | 1.5 px/F | gold, 14 | 1.0 | 30 | `#ffd740` |
| NPC3 | grüner Schleim-Geist | 1.0 px/F | grün, 12 | 0.9 | 30 | `#69f0ae` |

#### Wanderndes Verhalten (`mode: 'wander'`)
Grid-basiert — läuft zum Mittelpunkt der nächsten Zelle, wählt dort eine zufällige freie Richtung (bevorzugt keine Umkehr via `lastDir`). Normale Geschwindigkeit.

#### Verfolgungsverhalten (`mode: 'chase'`)
Wird ausgelöst wenn:
1. Spieler im Sichtradius des Spielers (`fog`-Slider-Wert als Weltdistanz)
2. **UND** Spieler liegt in NPC-Laufrichtung ohne Wand dazwischen (`_npcHasLos`)

Im Chase-Modus: 2× Geschwindigkeit, BFS-Pfadfindung zur Spielerposition (`_npcBfsNext`).

**Sichtverlust:** Bei Verlust der Sichtlinie wird `chaseLostAt` gesetzt. Nach 10 Sekunden ohne erneuten Sichtkontakt → zurück zu wander. Erneuter Sichtkontakt in dieser Zeit → 10-Sek.-Timer neu starten.

**Visuell im Chase-Modus:** roter Glow (`#ff1744`, blur 28) statt normaler NPC-Farbe.

#### Kollision
- Nur aktiv wenn `mode === 'chase'`; Kontaktdistanz `< cell * 0.5`
- **Normal:** Spieler flackert 600 ms (alpha-Toggle alle 70 ms), NPC erhält 10 Sek. Sperrfrist (`cooldownUntil`), `_npcHitUntil`/`_npcHitColor` gesetzt → farbiger Rahmen um Spell-Leiste
- **Immun (Sprung oder Geist aktiv):** NPC bricht Chase ab (zurück zu wander), kein Flicker, keine Sperrfrist

#### Pforte-Interaktion
NPCs können die vom Spieler geöffnete Pforte nicht nutzen. `_isNpcWall(row, col, dir)` behandelt die Pforte als undurchdringliche Wand — wirkt auf Wandern, LOS-Check und BFS.

#### Spieler-Feedback
- **Flicker:** `_flickerUntil` — Spieler-Alpha wechselt 70-ms-Takt für 600 ms
- **Spell-Leiste chase-Rahmen:** CSS-Klasse `.chased` mit rotem 1-px-Pulsrahmen (1,4-Sek.-Zyklus), solange mind. ein NPC verfolgt
- **Spell-Leiste Treffer-Rahmen:** `_npcHitUntil` + `_npcHitColor` — 1-px box-shadow in NPC-Farbe, pulsierend (500-ms-Zyklus), 10 Sek., immer nur ein Effekt gleichzeitig

#### Hintergrundentfernung
`_removeBackground(img, bgTol)` — Pixel mit max. Kanaldifferenz < `bgTol` werden transparent gemacht. Gibt einen Canvas zurück, der als Bildquelle für `drawImage` genutzt wird.

### Mini-Map

Wird immer in der **linken oberen Ecke** des Canvas gezeichnet (screen space).

- Größe: `min(vw*0.22, vh*0.22, 160px)`, Zellgröße mind. 2 px/Zelle
- **Sackgassen (Sackgasse-Spell):** `_revealedDeadCells` — dunkles Grau-Blau `#3e3e52`; Zellen werden dauerhaft gespeichert sobald `deadAlpha > 0`, bleiben nach Ablauf des Spells sichtbar
- **Besuchte Zellen:** grau-blau `#6a6a8a`; übermalt `_revealedDeadCells` wenn Spieler eine Sackgasse selbst besucht
- Beide Sets: bei Zellgröße ≥4 px werden Wandöffnungen als 1-px-Konnektoren gezeichnet
- **Lösungspfad:** rote Linie (`#e53935`), `lineWidth = cs/5`, nur wenn `solutionAlpha > 0`
- **Items:** langsam blinkende Punkte in Spell-Farbe
- **NPCs:** farbige Dots in `mapColor`
- **Spieler:** leuchtender Dot in Roben-Farbe (`_robeColor`)

### Touch-Steuerung (Mobil)

Erkennung: `navigator.maxTouchPoints > 0` → `this._hasTouch`.

**Steuer-Oval** (`_ovalGeometry()`): Mittelpunkt `(vw/2, vh*0.70)`, `rx = min(vw,vh)*0.30`, `ry = rx*0.60`. Wird auf Canvas in Screen-Space gezeichnet (`_drawTouchControls`), halbtransparent mit 4 Richtungspfeilen; aktive Richtung leuchtet weiß.

**Gesten** (`_initTouchControls()`):
- `touchstart` im Oval: Bewegung startet sofort in Richtung des berührten Quadranten
- `touchmove`: Swipe-Delta > 12 px überschreibt die Richtung
- `touchend` / `touchcancel`: Bewegung stoppt sofort
- Discovery-Overlay: Tap auf OK-Button schließt das Overlay

**State:** `_touchDir` (aktuelle Richtung), `_touchActive` (Finger gedrückt) — beide werden in `_startNew()` zurückgesetzt.

### Render-Reihenfolge pro Frame

```
1.  canvas fill dark
2.  ctx.save / translate+scale (world space, zoom)
3.    maze.draw(ctx)
4.    game._drawBeacons(ctx)
5.    game._drawOpenedWall(ctx)
6.    game._drawItems(ctx)
7.    game._drawNpcs(ctx)
8.    maze.drawDeadEnds(ctx, ..., deadAlpha)
9.    maze.drawSolution(ctx, solutionAlpha)
10. ctx.restore
11. screen-space player draw (unabhängig vom Zoom)
12. _drawFog(ctx, fogMult)
13. Rückkehr-Flash
14. _drawMiniMap(ctx)        ← oben links, screen space
15. _drawDiscovery(ctx)      ← Erstfund-Overlay
16. _drawTouchControls(ctx)  ← nur auf Touch-Geräten
17. _updateSpellBar()
```

### Spell-Leiste (HTML, über Canvas)

- HTML-`<div id="spell-bar">` innerhalb `#canvas-wrap`
- **Desktop:** oberhalb des Canvas, 1 Reihe, 10 Slots à 52×52 px, GAP 5 px
- **Mobil:** `position: absolute; bottom: 0` — Overlay am unteren Canvas-Rand, 2 Reihen à 5 Slots, kleinere Slots (44 px Höhe), halbtransparenter Hintergrund
- Slot-Inhalt: Spell-Sprite-Icon (Originalproportionen, zentriert), Countdown oben-links, Ladungen unten-rechts
- **Aktivierungstaste:** oben-rechts, Farbe `#6870b8` (helleres Blau im Slot-Rahmen-Farbton), 10px/9px (Mobil)
- **Tooltip:** `data-tooltip`-Attribut mit Spell-Name, erscheint per CSS `::after` bei Hover
- **Leer** (nicht gefunden): nur dunkles Slot-Rechteck, kein Icon
- **Aktiv:** blauer Rahmen + Glow (CSS-Klasse `.active`)
- **Erschöpft** (gefunden, 0 Ladungen): Icon blass (`.depleted`, opacity 0.38)
- `border-radius: 4px` + `margin-bottom: 6px` (kein padding-bottom, damit Rahmen bündig anliegen)

---

## css/style.css

```
body (flex column, 100vh / 100dvh)
├── h1, #settings (hidden), #hud
├── #canvas-wrap (flex:1, position:relative)
│   ├── #spell-bar (Desktop: flex oben; Mobil: absolute bottom overlay)
│   ├── <canvas>
│   └── #overlay (z-index:20 auf Mobil)
└── #hint (auf Mobil: display:none)
```

Mobile Media Query: `@media (pointer: coarse)` — kleinere Spell-Slots, 2-reihige Leiste, `100dvh`.

`.hidden { display: none !important; }`
`#score`, `#level`, `#items-left`: `1.05rem`, weiß, tabular-nums.
`@keyframes score-flash`: skaliert `#score` auf 1,45× + goldgelbe Farbe, 420 ms, Klasse `.flash`.
`@keyframes chase-pulse`: 1-px roter Rahmen + Glow um `#spell-bar`, 1,4-Sek.-Zyklus, Klasse `.chased`.
`.sp-icon`: `aspect-ratio: 275/384`, `background-size: 500% 200%` — Sprite in Originalproportionen zentriert im Slot.

---

## Spielablauf

1. Laden → Overlay "Finde den Ausgang!" — **Enter** / Start-Button / Tap
2. 21×21 Labyrinth, Spieler unten Mitte, Items platziert (nur Spells mit `minLevel ≤ Level`)
3. Ziel: oben Mitte durch Nordöffnung (`_cy < 0`) → Sieg
4. Punkte + Level + nächstes Labyrinth wächst um 2×2
5. Erstmals gefundene Spells → Discovery-Overlay mit Pause

---
