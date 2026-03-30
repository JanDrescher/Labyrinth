# MageMaze – Projektdokumentation

**Stand:** 2026-03-29 (aktualisiert)
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
    ├── player.js      Spieler: Bewegung, Kollision, Darstellung, visitedCells, phasing
    └── game.js        Game-Loop, Kamera, Fog-of-War, Spells, Items, Beacons, UI
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
  #overlay     Start-/Gewinn-Overlay (Enter startet nächstes Labyrinth)
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

- **Punkte:** +10 Basis, +50 Zeitbonus pro gelöstem Labyrinth
- **Level:** startet bei 1, +1 bei jedem gelösten Labyrinth

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
Ansatz: Boden zuerst flächig füllen (`_makeFloorPattern`), dann Wände als gestrichelte Liniensegmente darüber (`_makeWallPattern`, `lineWidth = 2W`, `lineCap = 'round'`). Jede Wand wird genau einmal gezeichnet (N + W pro Zelle, dann Süd- und Ostrand). Runde Linienenden (`lineCap = 'round'`) erzeugen organisch wirkende Wandabschlüsse.
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
phasing         boolean — wenn true, werden Wandkollisionen ignoriert (Geist-Spell)
visitedCells    Set<number> — betretene Zellen (row*cols+col)
knownDeadCells  Set<number> — erkannte Sackgassen
```

**Kollision:** AABB, Hitbox `hw = cell/2 - 1`. Bei `phasing = true` werden interne Wände ignoriert; Südgrenze (Eingang) bleibt immer aktiv.

**Startposition:** `((mid + 0.5) * cell, (rows - 0.5) * cell)`

**Sprite:** Vier separate Dateien mit je 4 Walk-Frames horizontal, transparenter Hintergrund:
- `img/mage-s.png` (1945×528), `img/mage-n.png` (1945×528), `img/mage-w.png` (1945×528), `img/mage-e.png` (1456×396)

Frame-Wechsel alle 150 ms bei Bewegung, Frame 0 im Stand. Gezeichnet in Screengröße `cell × 0.80`. Keine Rotation — jede Datei zeigt die native Blickrichtung. Robe-Farbe per HSL-Hue-Substitution (`robeColor`-Property, hex oder hsl-String); zufälliger Farbton beim ersten Start, bleibt für die gesamte Spielsitzung konstant (gespeichert in `Game._robeColor`).

---

## js/game.js — Klasse `Game`

### Spell-System

`SPELL_DEFS` — 10 Slots (Index 0–9 = Taste 1–0). Jeder Eintrag enthält:
`name`, `duration` (s), `initialCount`, `itemColor`, `itemDiv` (Item-Seltenheit).

| Slot | Taste | Name        | Dauer | Start | itemDiv | Beschreibung |
|------|-------|-------------|-------|-------|---------|--------------|
| 0    | 1     | Pfad        | 5 s   | 2     | 10      | Lösungspfad anzeigen, Fade ab 2 s |
| 1    | 2     | Sackgasse   | 15 s  | 3     | 5       | Sackgassen ausgrauen, Fade ab 3 s |
| 2    | 3     | Sprung      | 5 s   | 2     | 8       | Kamera zoomt organisch raus (sin-Kurve) |
| 3    | 4     | Pforte      | 5 s   | 2     | 9       | Eine Wand in Blickrichtung öffnen |
| 4    | 5     | Geist       | 6 s   | 2     | 9       | Spieler kann alle Wände durchqueren |
| 5    | 6     | Leuchtfeuer | —     | 3     | 6       | Dauerhafter Leuchtpunkt an aktueller Position |
| 6    | 7     | Orakel      | 4 s   | 2     | 12      | Fog komplett entfernen, Fade zurück in letzter Sekunde |
| 7    | 8     | Rückkehr    | —     | 3     | 7       | Sofort-Teleport zum Eingang |
| 8    | —     | (leer)      | —     | —     | —       | — |
| 9    | —     | (leer)      | —     | —     | —       | — |

**Spell-Counts** werden nicht zwischen Leveln zurückgesetzt.
**Sonder-Routing** in keydown: Index 3 → `_activateWallSpell()`, Index 5 → `_activateLightSpell()`, Index 7 → `_activateReturnSpell()`.

### Item-System

Items pro Labyrinth: `Math.max(1, floor(√(cols×rows) / itemDiv))` pro Spell.
Aufnahme durch Drüberlaufen → +1 Ladung. Pulsierende Leuchtpunkte mit Spell-Nummer.

### Punktevergabe

- **+10** immer beim Lösen
- **+50 Zeitbonus** wenn `Zeit < (cols−1)×(rows−1)/2` Sekunden
- Overlay zeigt `(+10)` bzw. `(+10 +50 Zeitbonus)` in grün

### Level-Progression

Bei jedem gelösten Labyrinth: Level +1, Spalten/Zeilen +2 (max 80), Sichtweite +5 px (max 400).

### Admin-UI

Tastensequenz **q→w→e→r→t** togglet: Settings-Panel + "Neues Labyrinth" + "Lösung zeigen".
Standard: versteckt. **Enter** startet nächstes Labyrinth wenn Overlay sichtbar.

### Kamera & Zoom

Normale Ansicht: `ctx.translate(Math.round(vcx-px), Math.round(vcy-py))`
Sprung-Spell: `ctx.translate(vcx,vcy); ctx.scale(zoom,zoom); ctx.translate(-px,-py)`
Zoom-Kurve: `zoom = 1 − 0.55 × sin(π × progress)` (0→1 über 5s).

**Spieler wird außerhalb des Zoom-Transforms gezeichnet** → bleibt bei Sprung immer gleich groß.

### Fog-of-War (`_drawFog`)

Offscreen-Canvas-Ansatz mit `destination-out` für mehrere Lichtquellen:
1. Offscreen-Canvas mit Fog-Farbe füllen
2. Per `punchLight()` transparente Löcher einschneiden (Spieler + Beacons)
3. Ergebnis mit `fogMult` (0–1) auf Hauptcanvas zeichnen

`fogMult = 1 − orakelAlpha` → Orakel-Spell blendet Fog aus.

### Beacon-System (Leuchtfeuer)

- `this._beacons = [{ cx, cy }, ...]` — Weltkoordinaten
- Reset bei `_startNew()`
- Lichtradius: `max(40, fog × 0.75)`, Fade: `min(fade, 55)`
- Visuell: flackernder oranger Orb in Weltspace


### Render-Reihenfolge pro Frame

```
1.  canvas fill dark
2.  ctx.save / translate+scale (world space, zoom)
3.    maze.draw(ctx)
4.    game._drawBeacons(ctx)
5.    game._drawOpenedWall(ctx)
6.    game._drawItems(ctx)
7.    maze.drawDeadEnds(ctx, ..., deadAlpha)
8.    maze.drawSolution(ctx, solutionAlpha)
9.    player.draw(ctx)  ← NICHT hier, sondern in screen space
10. ctx.restore
11. screen-space player draw (unabhängig vom Zoom)
12. _drawFog(ctx, fogMult)
13. Rückkehr-Flash
14. _updateSpellBar()
```

### Spell-Leiste (HTML, über Canvas)

- HTML-`<div id="spell-bar">` innerhalb `#canvas-wrap`, oberhalb des Canvas
- 10 Slots à 52×52 px, GAP 5 px, zentriert, `padding-bottom: 6px`
- Slot: Countdown oben-links, Taste+Name mittig, Ladungen unten-rechts
- Aktiv: blauer Rahmen + Glow (CSS-Klasse `.active`); Erschöpft: opacity 0.38 (`.depleted`)

---

## css/style.css

```
body (flex column, 100vh)
├── h1, #settings (hidden), #hud
├── #canvas-wrap (flex:1)
└── #hint
```

`.hidden { display: none !important; }`
`#score`, `#level`: `1.05rem`, weiß, tabular-nums.

---

## Spielablauf

1. Laden → Overlay "Finde den Ausgang!" — **Enter** oder Start-Button
2. 21×21 Labyrinth, Spieler unten Mitte, Items platziert
3. Ziel: oben Mitte durch Nordöffnung (`_cy < 0`) → Sieg
4. Punkte + Level + nächstes Labyrinth wächst um 2×2

---

## Nächstes Feature

**Mobile-Optimierung:** Touch-Steuerung und responsive Darstellung für Smartphones und Tablets.
- Virtuelle Steuerung (D-Pad oder Swipe)
- Spell-Leiste touch-freundlich (größere Tap-Flächen)
- Viewport/Canvas-Skalierung für kleine Bildschirme

---

