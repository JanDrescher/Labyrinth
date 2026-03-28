# MageMaze – Projektdokumentation

**Stand:** 2026-03-28
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
    ├── maze.js        Labyrinth-Generator, Renderer, BFS-Löser
    ├── player.js      Spieler: Bewegung, Kollision, Darstellung
    └── game.js        Game-Loop, Kamera, Fog-of-War, UI-Steuerung
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
<h1>           Titel
#settings      Schieberegler-Panel (5 Regler)
#hud           Timer, Labyrinth-Größe, Buttons
#canvas-wrap   Spielfeld-Container (flex, nimmt restlichen Raum ein)
  <canvas>     Spielfeld
  #overlay     Start-/Gewinn-Overlay
<p#hint>       Tastatur-Hinweis
```

### Schieberegler (`#settings`)

| ID          | Label              | Min | Max | Default | Wirkung                            |
|-------------|--------------------|-----|-----|---------|-------------------------------------|
| `inp-cols`  | Spalten            | 5   | 80  | 20      | Maze neu generieren (on `change`)   |
| `inp-rows`  | Zeilen             | 5   | 80  | 20      | Maze neu generieren (on `change`)   |
| `inp-cell`  | Gangbreite (px)    | 4   | 80  | 80      | Maze neu generieren (on `change`)   |
| `inp-fog`   | Sichtweite (px)    | 15  | 400 | 120     | Nur Lichtkegel-Radius, kein Rebuild |
| `inp-fade`  | Überblendung (px)  | 0   | 150 | 100     | Nur Fade-Breite, kein Rebuild       |

Alle Regler zeigen den Wert live (`on input`) rechts daneben an.

### HUD-Buttons

- **Neues Labyrinth** → `game._startNew()`
- **Lösung zeigen / Lösung verbergen** → Toggle, `aria-pressed` wird gesetzt, Button färbt sich dunkelrot wenn aktiv

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

### `_generate()` — Recursive Backtracker (DFS)

- Startet bei Zelle `(0, 0)`
- Stack-basierter DFS: wählt zufälligen unbesuchten Nachbarn, entfernt Trennwand, geht weiter
- Erzeugt ein **perfektes Labyrinth** (keine Schleifen, jede Zelle genau einmal erreichbar)

### `draw(ctx)` — Thick-Wall-Renderer

Wandstärke `W = Math.max(3, Math.round(cell * 0.10))` pro Seite, Gangbreite `s = cell - 2*W`.

1. Gesamte Maze-Fläche mit Wandmuster füllen (via `_wallPattern`, s.u.)
2. Gänge als Bodenflächen freischneiden (mit `_floorPattern`, s.u.):
   - Jede Zelle: `fillRect(c*cell+W, r*cell+W, s, s)` — Zellinnenraum
   - Offene Ostwand: `fillRect(c*cell+cell-W, r*cell+W, 2W, s)` — Verbindungsgang East
   - Offene Südwand: `fillRect(c*cell+W, r*cell+cell-W, s, 2W)` — Verbindungsgang South
3. Eingangs-/Ausgangsöffnung an Maze-Kante freischneiden
4. **Eingangs-Marker** (grün `#00c853`): 3px-Streifen am unteren Rand, Breite `s`
5. **Ausgangs-Marker** (rot `#d50000`): 3px-Streifen am oberen Rand, Breite `s`

### `_makeWallPattern(ctx)` — Bruchstein-Wandmuster

Erzeugt einmalig ein `CanvasPattern` (gecacht als `this._wallPattern`) aus einem Off-screen-Canvas:

- **Mauerverband (Running Bond):** Stein `14×8`px, Fuge `2`px, Reihe 2 um halbe Steinbreite versetzt
- Drei dunkle Lila-Grautöne (`#2a2640`, `#231f38`, `#302c46`) + Highlight/Shadow-Bevel + feiner Riss
- Fugenfarbe: `#14121e`, horizontale Fuge mit minimalem Lila-Glimmer `rgba(100,80,180,0.12)`

### `_makeFloorPattern(ctx)` — Mauerverband-Bodenmuster

Erzeugt einmalig ein `CanvasPattern` (gecacht als `this._floorPattern`) aus einem `30×30`px Off-screen-Canvas:

- **Mauerverband (Running Bond):** Ziegel `30×13`px, Fuge `2`px, Reihe 2 um `16`px versetzt
- Drei leicht verschiedene Ziegelfarben (`#aaa29a`, `#a29a91`, `#b0a8a0`) + Highlight/Shadow-Bevel
- Fugenfarbe: `#57524e`

### `solution()` — BFS-Kürzester-Pfad (gecacht)

- BFS von Eingang `(rows-1, mid)` zu Ausgang `(0, mid)`
- Nutzt `walls[r][c][dir]` zur Durchquerbarkeit
- Rekonstruiert Pfad via `prev`-Map
- Ergebnis wird in `this._solution` gecacht → nur einmal pro Maze berechnet
- Gibt Array von `[row, col]`-Paaren zurück

### `drawSolution(ctx)`

- Ruft `solution()` auf
- Zeichnet rote Linie (`#e53935`) entlang der Zellmittelpunkte
- `lineWidth = Math.max(1, cell/5)`, `globalAlpha = 0.75`
- Wird nur gezeichnet wenn `game._showSolution === true`

### `canMove(r, c, dir)`

- Gibt `true` zurück wenn Wand in Richtung `dir` bei `(r,c)` nicht vorhanden
- Bounds-Check enthalten

---

## js/player.js — Klasse `Player`

### Konstruktor

```
_cx, _cy        Pixelposition des Mittelpunkts (float)
_speed          3 px/Frame
_facing         'N' | 'S' | 'E' | 'W' — letzte Bewegungsrichtung, initial 'N'
onGoal          Callback, wird einmal gefeuert wenn Spieler gewinnt
_done           true nach Sieg → update() tut nichts mehr
visitedCells    Set<number> — alle betretenen Zellen (Key: row*cols+col), startet mit Eingangs-Zelle
knownDeadCells  Set<number> — einmal als Sackgasse erkannte Zellen, wächst nur, wird nie geleert
```

**Startposition:** Mitte der Eingangs-Zelle = `((mid + 0.5) * cell, (rows - 0.5) * cell)`

### `update(heldDirs)` — Frame-Update

- `heldDirs` ist ein `Set<'N'|'S'|'E'|'W'>` aus `game.js`
- Pro gehaltener Taste: `_moveX(±speed)` oder `_moveY(±speed)`
- `_facing` wird auf die zuletzt iterierte Richtung gesetzt
- **Siegbedingung:** `_cy < 0` → Spieler hat nördliche Öffnung des Ausgangs passiert

### Kollisionssystem (AABB)

**Hitbox:** Halbbreite `hw = cell/2 - 1` um den Mittelpunkt

**`_moveX(dx)`:**
- Ermittelt aktuelle Zelle via `Math.floor(_cy/cell)`, `Math.floor(_cx/cell)`
- Bei `dx > 0`: prüft ob rechte Kante `(_cx + hw)` Ostwand von `walls[row][col].E` kreuzt → clampt
- Bei `dx < 0`: prüft Westwand analog
- Bounds-Check: `row/col` außerhalb → früher Return

**`_moveY(dy)`:**
- Bei `dy > 0` (Süd): clampt wenn `walls[row][col].S === true` **oder** `row >= rows-1`
  - `row >= rows-1` verhindert Herausfallen durch den offenen Eingang
- Bei `dy < 0` (Nord): clampt wenn `walls[row][col].N === true`
  - Ausgangs-Zelle hat `walls[0][mid].N = false` → Spieler kann hindurch → Sieg

### `draw(ctx)` — Wizard-Sprite

Radius `r = Math.max(4, cell * 0.30)`, gezeichnet im lokalen Koordinatensystem (`ctx.translate` auf Spielerposition):

- **Spitzer Hut** (`#311b92`): Dreieck, Spitze bei `r*1.85` in Blickrichtung, Basis ±`r*0.55` senkrecht dazu — wird zuerst gezeichnet, damit die Robe die Basis überdeckt
- **Robe** (`#6a1b9a`): Kreis Radius `r` + radialer Glanz-Gradient (`rgba(186,104,200,0.45)`)
- **Goldene Sterne** (`#ffd740`): 4 kleine Kreise (Radius `r*0.09`) an festen Positionen auf der Robe
- **Augen** (`rgba(255,255,255,0.95)`): 2 weiße Punkte (Radius `r*0.13`) in Blickrichtung bei Abstand `r*0.52`, seitlicher Versatz `r*0.20`

---

## js/game.js — Klasse `Game`

### Kamera-System

Der Canvas ist ein **festes Viewport-Fenster** — das Labyrinth bewegt sich darunter:

```javascript
ctx.translate(Math.round(vcx - player._cx), Math.round(vcy - player._cy))
```

- `vcx = canvas.width / 2`, `vcy = canvas.height / 2`
- Spieler ist immer in der Mitte des Viewports
- **`Math.round()`** ist wichtig: verhindert Subpixel-Rendering-Artefakte (1px-Lücken zwischen Bodenkacheln)

### Canvas-Größe

- `ResizeObserver` auf `#canvas-wrap` → `_fitCanvas()` bei jedem Layout-Change
- `canvas.width = Math.floor(wrap.clientWidth * 0.9)`
- `canvas.height = Math.floor(wrap.clientHeight * 0.9)`
- Keine Größenänderung bei Fog/Fade-Slider-Änderungen

### Fog-of-War — `_drawFog(ctx, cx, cy)`

Drei-Schichten-System pro Frame:

1. **Dark fill:** `fillRect` mit `rgb(13,13,26)` — gesamte Canvas schwarz
2. **World layer:** Maze + (optional) Lösung + Spieler, im World-Transform
3. **Fog overlay:** zwei Passes:
   - Radialer Gradient von `(fog, transparent)` bis `(fog+fade, opaque)` als `fillRect`
   - Evenodd-Pfad für saubere Kanten außerhalb des Gradienten-Außenkreises

**Farbe:** `FOG_COLOR = '13,13,26'` (= `--bg` aus CSS)

### Tastatur-Handling

```javascript
keydown → _heldDirs.add(dir)
keyup   → _heldDirs.delete(dir)
blur    → _heldDirs.clear()   // verhindert "hängende" Tasten
```

`KEY_DIR`-Mapping: `ArrowUp/W → N`, `ArrowRight/D → E`, `ArrowDown/S → S`, `ArrowLeft/A → W`

### Render-Reihenfolge pro Frame

```
1. canvas fill dark
2. ctx.save / translate
3.   maze.draw(ctx)
4.   maze.drawDeadEnds(ctx, visitedCells, knownDeadCells, px, py, fog+fade)
5.   maze.drawSolution(ctx)   ← nur wenn _showSolution
6.   player.draw(ctx)
7. ctx.restore
8. _drawFog(ctx)
```

### Lebenszyklus

- `_startNew()`: Overlay verstecken, `_fitCanvas()`, neues `Maze` + `Player`, RAF starten
- `_win()`: einmalig (Guard `_won`), Zeit stoppen, Overlay zeigen
- Struktur-Schieberegler (`cols/rows/cell`): `change`-Event → `_startNew()`
- Fog-Schieberegler (`fog/fade`): nur Live-Label-Update, kein Rebuild

---

## css/style.css

### Layout-Prinzip

```
body (flex column, height 100vh, overflow hidden)
├── h1              flex-shrink: 0
├── #settings       flex-shrink: 0, width 90vw
├── #hud            flex-shrink: 0
├── #canvas-wrap    flex: 1, min-height: 0  ← nimmt restlichen Raum
│   └── canvas      Dimensionen per JS
└── #hint           flex-shrink: 0
```

### Wichtige Designentscheidungen

- `min-height: 0` auf `#canvas-wrap` notwendig damit Flex-Child schrumpfen kann
- Canvas hat keine CSS `width`/`height` — nur die HTML-Attribute (gesetzt per JS) bestimmen die Darstellung
- `image-rendering: pixelated` auf Canvas für scharfe Pixel bei kleinen Gangbreiten
- `#canvas-wrap`: `border: 2px solid var(--surface)` + `box-shadow: 0 0 24px rgba(21,101,192,.35)` → dezentes blaues Glühen
- Farbpalette: `--bg #0d0d1a`, `--surface #1a1a2e`, `--accent #1565c0`, `--text #e0e0e0`, `--muted #7986cb`
- `#btn-solution[aria-pressed="true"]`: Hintergrund `#b71c1c`, roter Glow

---

## Spielablauf

1. Seite laden → Overlay erscheint mit "Finde den Ausgang!"
2. **Start** klicken → Maze wird generiert, Timer startet
3. Spieler startet in **Eingangs-Zelle (unten Mitte)**
4. Ziel: **Ausgangs-Zelle (oben Mitte)** erreichen und durch die Nordöffnung laufen (`_cy < 0`)
5. Siegbedingung erfüllt → Timer stoppt, Overlay zeigt Zeit

## Sackgassen-Markierung (implementiert)

Sackgassen-Bereiche werden ausgegraut, sobald der Spieler erkennen kann, dass sie keine Weiterführung haben.

### Algorithmus — Fog-bounded Flood Fill (`maze.js → drawDeadEnds`)

**Signatur:** `drawDeadEnds(ctx, visitedCells, knownDeadCells, playerCx, playerCy, fogRadius)`

Von jeder besuchten Zelle aus werden alle angrenzenden, noch nicht besuchten Zellen per BFS untersucht:

1. BFS expandiert durch unbesuchte, noch nicht als Sackgasse bekannte Zellen
2. Expansion stoppt an: Wänden · besuchten Zellen · `knownDeadCells` · Fog-Grenze
3. Führt irgendwo eine offene Passage in eine Zelle **außerhalb** des Sichtradius → `deadEnd = false`
4. Führt eine offene Passage aus dem Raster nach Norden (`nr < 0`) → das ist der Ausgang → `deadEnd = false`
5. Passage nach Süden aus dem Raster (`nr >= rows`) → Eingang → wird ignoriert (kein Effekt)
6. Bleibt die gesamte Region innerhalb des Sichtfelds → `deadEnd = true` → alle Zellen in `knownDeadCells` aufnehmen

### Persistenz (`player.js`)

- `visitedCells` Set — alle vom Spieler betretenen Zellen (Key: `row * cols + col`)
- `knownDeadCells` Set — einmal als Sackgasse erkannte Zellen, wächst nur, wird nie geleert

Beide Sets leben auf dem `Player`-Objekt und werden bei `_startNew()` durch neues `Player`-Objekt zurückgesetzt.

Beim Zeichnen werden **alle** `knownDeadCells` grau gefärbt — auch bereits besuchte Zellen, damit der Spieler beim Durchlaufen eines Sackgassen-Bereichs kein Weiß sieht.

---

## Bekannte Grenzen / Designentscheidungen

- Maze-Generator startet DFS immer bei `(0,0)` → statistisch längere Wege in der oberen linken Ecke
- Spielgeschwindigkeit ist fix (`3 px/Frame`) — nicht skaliert mit Gangbreite
- Lösung wird via BFS berechnet (kürzester Pfad), gecacht, nicht animiert
- Spieler kann nicht durch den Eingang (Süd) herausfallen — untere Grenze wird immer geblockt
