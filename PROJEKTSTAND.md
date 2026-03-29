# MageMaze – Projektdokumentation

**Stand:** 2026-03-29
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
│   └── style.css      Layout, Themes, Slider-Styling
└── js/
    ├── maze.js        Labyrinth-Generator, Renderer, BFS-Löser, Dead-End-Erkennung
    ├── player.js      Spieler: Bewegung, Kollision, Darstellung, visitedCells
    └── game.js        Game-Loop, Kamera, Fog-of-War, Spells, Items, UI-Steuerung
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
<h1>           Titel "MageMaze"
#settings      Schieberegler-Panel (5 Regler) — standardmäßig versteckt
#hud           Timer, Punkte, Level, Buttons (Buttons standardmäßig versteckt)
#canvas-wrap   Spielfeld-Container (flex, nimmt restlichen Raum ein)
  <canvas>     Spielfeld
  #overlay     Start-/Gewinn-Overlay
<p#hint>       Tastatur-Hinweis
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

### HUD

```
Zeit  [0.0 s]  Punkte [0]  Level [1]  [Neues Labyrinth*]  [Lösung zeigen*]
```
`*` standardmäßig versteckt, via qwert einblendbar.

- **Punkte:** startet bei 0, wächst pro Level (s. Punktevergabe)
- **Level:** startet bei 1, +1 bei jedem gelösten Labyrinth

---

## js/maze.js — Klasse `Maze`

### Konstruktor `new Maze(cols, rows, cell)`

- Erstellt `walls[r][c] = { N, E, S, W }` — `true` = Wand vorhanden
- Alle Wände starten als `true`
- Ruft `_generate()` auf
- Öffnet danach Eingang und Ausgang:
  - **Eingang:** `walls[rows-1][mid].S = false` (unten Mitte, Südwand)
  - **Ausgang:** `walls[0][mid].N = false` (oben Mitte, Nordwand)
  - `mid = Math.floor(cols / 2)`
  - **Hinweis:** Ungerade Spaltenanzahl (z.B. 21) ergibt symmetrisches Labyrinth

### `_generate()` — Recursive Backtracker (DFS)

- Startet bei Zelle `(0, 0)`
- Stack-basierter DFS: wählt zufälligen unbesuchten Nachbarn, entfernt Trennwand, geht weiter
- Erzeugt ein **perfektes Labyrinth** (keine Schleifen, jede Zelle genau einmal erreichbar)

### `draw(ctx)` — Thick-Wall-Renderer

Wandstärke `W = Math.max(3, Math.round(cell * 0.10))` pro Seite, Gangbreite `s = cell - 2*W`.

1. Gesamte Maze-Fläche mit Wandmuster füllen (via `_wallPattern`)
2. Gänge als Bodenflächen freischneiden (mit `_floorPattern`)
3. Eingangs-/Ausgangsöffnung an Maze-Kante freischneiden
4. **Eingangs-Marker** (grün `#00c853`): 3px-Streifen
5. **Ausgangs-Marker** (rot `#d50000`): 3px-Streifen

### `_makeWallPattern(ctx)` — Bruchstein-Wandmuster

Erzeugt einmalig ein `CanvasPattern` aus Off-screen-Canvas:
- **Mauerverband:** Stein `14×8`px, drei dunkle Lila-Grautöne + Highlight/Shadow/Riss
- Fugenfarbe: `#14121e`, horizontale Fuge mit Lila-Glimmer

### `_makeFloorPattern(ctx)` — Boden-Ziegelmuster

Erzeugt einmalig ein `CanvasPattern` aus `30×30`px Off-screen-Canvas:
- **Mauerverband:** Ziegel `30×13`px, drei Ziegelfarben + Highlight/Shadow
- Fugenfarbe: `#57524e`

### `solution()` — BFS-Kürzester-Pfad (gecacht)

- BFS von Eingang `(rows-1, mid)` zu Ausgang `(0, mid)`
- Ergebnis wird in `this._solution` gecacht

### `drawSolution(ctx, alpha = 0.75)`

- Zeichnet roten Lösungspfad (`#e53935`), alpha-steuerbar (für Spell-Fade)

### `drawDeadEnds(ctx, visitedCells, knownDeadCells, playerCx, playerCy, fogRadius, alpha = 1)`

- BFS läuft **immer** (unabhängig von alpha) → aktualisiert `knownDeadCells`
- Zeichnet bekannte Sackgassen mit `rgba(18,14,32,0.78)` multipliziert mit `alpha`
- alpha = 0 → kein Zeichnen, aber BFS läuft weiter

### `canMove(r, c, dir)`

- Gibt `true` zurück wenn Wand in Richtung `dir` bei `(r,c)` nicht vorhanden

---

## js/player.js — Klasse `Player`

### Konstruktor

```
_cx, _cy        Pixelposition des Mittelpunkts (float)
_speed          3 px/Frame
_facing         'N' | 'S' | 'E' | 'W' — letzte Bewegungsrichtung, initial 'N'
onGoal          Callback, wird einmal gefeuert wenn Spieler gewinnt
_done           true nach Sieg → update() tut nichts mehr
visitedCells    Set<number> — alle betretenen Zellen (Key: row*cols+col)
knownDeadCells  Set<number> — einmal als Sackgasse erkannte Zellen
```

**Startposition:** Mitte der Eingangs-Zelle = `((mid + 0.5) * cell, (rows - 0.5) * cell)`

### `update(heldDirs)` — Frame-Update

- `heldDirs`: Set aus game.js, per Tastatur befüllt
- Kollisionssystem (AABB), Hitbox: Halbbreite `hw = cell/2 - 1`
- **Siegbedingung:** `_cy < 0`

### `draw(ctx)` — Wizard-Sprite

Radius `r = Math.max(4, cell * 0.30)`:
- Spitzer Hut (`#311b92`), Robe (`#6a1b9a`) + Glanz-Gradient
- Goldene Sterne (`#ffd740`), Augen in Blickrichtung

---

## js/game.js — Klasse `Game`

### Spell-System

```js
const SPELL_DEFS = [
  { name: 'Pfad',      duration: 5,  initialCount: 2, itemColor: '#4dd0e1' },
  { name: 'Sackgasse', duration: 15, initialCount: 3, itemColor: '#ffb300' },
  null, null, null, null, null, null, null, null,
]
```

- 10 Spell-Slots, Tasten **1–0**
- Counts werden **nicht** zwischen Leveln zurückgesetzt
- `activeUntil` wird bei `_startNew()` zurückgesetzt (laufende Effekte abbrechen)

**Spell 1 – Pfad:**
- 5 Sekunden, Fade ab Sekunde 2
- Überlagert sich additiv mit "Lösung zeigen"-Button

**Spell 2 – Sackgasse:**
- 15 Sekunden, Fade ab Sekunde 3
- Zeigt Sackgassen-Ausgrauung (BFS läuft immer im Hintergrund)

### Item-System

Items werden pro Labyrinth zufällig platziert; Aufnahme durch Drüberlaufen (+1 Spell-Ladung).

**Menge pro Labyrinth** (`Math.floor(√(cols×rows) / Divisor)`):

| Spell | Divisor | 21×21 | 41×41 | 61×61 |
|-------|---------|-------|-------|-------|
| Pfad (selten) | 10 | 2 | 4 | 6 |
| Sackgasse     | 5  | 4 | 8 | 12 |

Items sind pulsierende Leuchtpunkte (Cyan / Bernstein), durch Fog-of-War verdeckt.

### Punktevergabe

- **+10 Punkte** bei jedem gelösten Labyrinth
- **+50 Punkte Zeitbonus** wenn `Zeit < (cols−1)×(rows−1)/2` Sekunden
- Overlay zeigt `(+10)` bzw. `(+10 +50 Zeitbonus)` in grün

### Level-Progression

Bei jedem gelösten Labyrinth:
- Level +1
- Spalten +2, Zeilen +2 (max 80)
- Sichtweite +5 px (max 400)
- Spell-Counts bleiben erhalten

### Admin-UI

Tastensequenz **q→w→e→r→t** togglet: Settings-Panel + "Neues Labyrinth" + "Lösung zeigen".
Standardmäßig versteckt beim Laden.

### Kamera-System

```javascript
ctx.translate(Math.round(vcx - player._cx), Math.round(vcy - player._cy))
```
`Math.round()` verhindert Subpixel-Artefakte.

### Render-Reihenfolge pro Frame

```
1. canvas fill dark
2. ctx.save / translate (world space)
3.   maze.draw(ctx)
4.   game._drawItems(ctx)
5.   maze.drawDeadEnds(ctx, ..., deadAlpha)
6.   maze.drawSolution(ctx, solutionAlpha)   ← nur wenn alpha > 0
7.   player.draw(ctx)
8. ctx.restore
9. _drawFog(ctx)
10. _drawSpellBar(ctx)                        ← screen space, über Fog
```

### Spell-Leiste (Canvas, screen space)

- 10 Slots à 52×52 px, Abstand 5 px, zentriert, y = 5 px vom Canvas-Rand
- Pro Slot: Countdown oben-links, Taste + Spell-Name mittig, Ladungen unten-rechts
- Aktiver Slot: blauer Rahmen + Glow
- Erschöpfter Slot: opacity 0.38

### Fog-of-War

Drei-Schichten-System:
1. Dark fill canvas
2. Radialer Gradient (transparent → opaque) ab Fog-Radius
3. Evenodd-Pfad für harte Außenkante

---

## css/style.css

### Layout

```
body (flex column, height 100vh, overflow hidden)
├── h1              flex-shrink: 0
├── #settings       flex-shrink: 0  ← standardmäßig hidden
├── #hud            flex-shrink: 0
├── #canvas-wrap    flex: 1, min-height: 0
│   └── canvas      Dimensionen per JS
└── #hint           flex-shrink: 0
```

- `.hidden { display: none !important; }` — global verwendbar
- `#score`, `#level`: `font-size: 1.05rem`, weiß, tabular-nums
- `#timer`: `font-size: 0.95rem`, weiß, tabular-nums

---

## Spielablauf

1. Seite laden → Admin-UI versteckt, Overlay mit "Finde den Ausgang!"
2. **Start** → Labyrinth 21×21 generiert, Timer startet, Items platziert
3. Spieler startet in **Eingangs-Zelle (unten Mitte)**
4. Ziel: **Ausgangs-Zelle (oben Mitte)** erreichen (`_cy < 0`)
5. Sieg → Punkte/Level aktualisiert, nächstes Labyrinth +2×2 Felder

---

## Bekannte Grenzen / Designentscheidungen

- Maze-Generator startet DFS immer bei `(0,0)` → statistisch längere Wege oben-links
- Spielgeschwindigkeit fix (`3 px/Frame`) — nicht skaliert mit Gangbreite
- Items erscheinen in zufälligen Zellen (kein Mindestabstand zum Start)
- Maximale Maze-Größe: 80×80 (Slider-Max)
