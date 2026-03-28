# Labyrinth – Projektdokumentation

**Stand:** 2026-03-25
**Pfad:** `/var/www/html/Labyrinth/` (produktiv) · `/home/admin/Labyrinth/` (Entwicklungs-Backup)
**Erreichbar unter:** `http://localhost:4000` — Apache-VirtualHost, startet automatisch mit dem System.

**Server-Setup:** Apache2 auf Debian mit zwei VirtualHosts:
- Port 80 → `/var/www/wordpress` (WordPress)
- Port 4000 → `/var/www/html/Labyrinth` (dieses Projekt)
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
| `inp-cell`  | Gangbreite (px)    | 4   | 40  | 40      | Maze neu generieren (on `change`)   |
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

### `draw(ctx)`

- Füllt den Maze-Bereich weiß: `fillRect(0, 0, cols*cell, rows*cell)`
- Zeichnet alle stehenden Wände als 1px-Linien in `#1a1a2e`
- Optimierung: N- und W-Wand pro Zelle, S nur letzte Zeile, E nur letzte Spalte
- **Eingangs-Marker** (grün `#00c853`): 3px-Streifen am unteren Rand, Mitte
- **Ausgangs-Marker** (rot `#d50000`): 3px-Streifen am oberen Rand, Mitte

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
_cx, _cy     Pixelposition des Mittelpunkts (float)
_speed       1.5 px/Frame
_facing      'N' | 'S' | 'E' | 'W' — letzte Bewegungsrichtung, initial 'N'
onGoal       Callback, wird einmal gefeuert wenn Spieler gewinnt
_done        true nach Sieg → update() tut nichts mehr
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

### `draw(ctx)`

- **Körper:** blauer Kreis (`#1565c0`), Radius `Math.max(2, cell * 0.28)`
- **Richtungs-Auge:** kleiner weißer Kreis (`rgba(255,255,255,0.92)`)
  - Radius: `Math.max(1, r * 0.28)`
  - Distanz vom Mittelpunkt: `r * 0.48` in Richtung `_facing`
  - Winkelberechnung: `{ N: -π/2, S: π/2, E: 0, W: π }`

---

## js/game.js — Klasse `Game`

### Kamera-System

Der Canvas ist ein **festes Viewport-Fenster** — das Labyrinth bewegt sich darunter:

```javascript
ctx.translate(vcx - player._cx, vcy - player._cy)
```

- `vcx = canvas.width / 2`, `vcy = canvas.height / 2`
- Spieler ist immer in der Mitte des Viewports
- Maze-Koordinaten bleiben unverändert

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
4.   maze.drawSolution(ctx)   ← nur wenn _showSolution
5.   player.draw(ctx)
6. ctx.restore
7. _drawFog(ctx)
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

## Nächstes Feature (in Entwicklung)

### Sackgassen-Markierung — geplante Neuimplementierung

Ein erster Versuch wurde implementiert und wieder zurückgerollt (git: `0ef2e1c` → revert `f43fa5b`).

**Problem des ersten Versuchs:** Das System hat alle Sackgassen innerhalb des Sichtkreises ausgegraut, unabhängig davon ob der Spieler von seiner aktuellen Position überhaupt Zugang zu diesen Bereichen hatte. Das war ein unfairer Informationsvorteil.

**Gewünschtes Verhalten:**
- Sackgassen dürfen nur ausgegraut werden, wenn der Spieler den Bereich auf seinem bisherigen Weg bereits passiert hat oder von seiner aktuellen Position aus direkt (ohne unbekannte Kreuzungen zu passieren) erreichbar war
- Konkret: Nur Sackgassen ausgrauen, die vom Spieler aus über **bereits besuchte/bekannte Pfade** erreichbar sind
- Bereiche hinter noch nie gesehenen Kreuzungen bleiben unmarkiert

**Lösungsansatz für morgen:**
- Spieler-Besuchshistorie tracken: `visitedCells` Set der vom Spieler betretenen Zellen
- Nur Sackgassen ausgrauen, die von einer besuchten Zelle aus erreichbar sind, ohne eine unbesuchte Kreuzung zu passieren
- Alternativ: Sackgassen-Trace nur starten, wenn der Spieler selbst in der Sackgasse oder im dazugehörigen Korridor steht/stand

---

## Bekannte Grenzen / Designentscheidungen

- Maze-Generator startet DFS immer bei `(0,0)` → statistisch längere Wege in der oberen linken Ecke
- Spielgeschwindigkeit ist fix (`1.5 px/Frame`) — nicht skaliert mit Gangbreite
- Lösung wird via BFS berechnet (kürzester Pfad), gecacht, nicht animiert
- Spieler kann nicht durch den Eingang (Süd) herausfallen — untere Grenze wird immer geblockt
