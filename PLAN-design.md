# Minecraft-Realms-Look für die World-Switcher UI

## Context

Die aktuelle UI (`app/public/{index.html,style.css,app.js}`) ist rein funktional gestaltet: weiße/dunkelgraue Karten, System-Font, abgerundete Ecken, Emoji-Icons (🌍/🟢) — sieht aus wie eine generische Web-App, nicht wie Minecraft. Der Nutzer möchte, dass die Oberfläche stärker an den offiziellen **Minecraft-Realms-Auswahlbildschirm** erinnert. Reine CSS/Markup/JS-Änderung innerhalb von `app/public/` — kein Build-Step, keine neue Architektur, Funktionalität (Polling, SSE-Logs, Confirm-Dialoge, Status-Handling) bleibt unverändert.

Entscheidungen aus Rückfrage an den Nutzer (alle "empfohlen"-Optionen gewählt):
- **Voller Realms-Look**: steiniger Hintergrund, Holz-Panel-Texturen, pixelige 3D-Bevel-Buttons, Pixel-Font, Welt-Kacheln als Item-Slots mit CSS-Block-Icons statt Emoji.
- **Font lokal einbetten** (nicht Google Fonts CDN) — funktioniert offline, kein externer Request.
- **CSS-Block-Icons** statt Emoji für die Welt-Thumbnails.

Zusätzliche Design-Entscheidung: Die UI wechselt von einem `prefers-color-scheme`-adaptiven Light/Dark-Theme zu **einem festen dunklen Stein/Holz-Theme** (Minecraft/Realms hat kein Light-Mode-Pendant — ein adaptives helles Theme würde dem Realms-Look widersprechen). Die `@media (prefers-color-scheme: dark)`-Regel in `style.css` entfällt entsprechend.

## Design-Richtung

**Farbpalette** (als CSS-Variablen in `:root`):
- Hintergrund: dunkles Stein-Grau (`#3a3a3a` Basis) mit sehr dezentem Blockraster-Muster (via `repeating-linear-gradient`, kein Bild-Asset nötig) statt Bild-Textur — hält den Content lesbar.
- Panels/Kacheln: Holzbrett-Braun (`#7a5a3a`-Ton, gestreift via `repeating-linear-gradient` für Maserung) mit pixeligem 3D-Bevel-Rand.
- Akzente: Gras-Grün (`#4b8f29`) für "läuft"/primäre Aktion, Gold/Amber (`#d9a441`, bereits vorhanden) für "startet/stoppt", Redstone-Rot (`#b02e26`) für Stop/destruktiv, Lapis-Blau (`#3f6fae`) für den Logs-Button, Stein-Grau für neutral/deaktiviert.

**Pixel-Bevel-Technik** (für `.btn`, `.tile`, `.badge`, `.confirm-box`, `.logs-box`): kein Bild-Asset, sondern gestapelte `inset box-shadow`s, die die charakteristische helle Kante oben/links + dunkle Kante unten/rechts + harter schwarzer Außenrand von Minecraft-GUI-Elementen nachbilden. `border-radius: 0` überall (Minecraft-UI ist eckig), `image-rendering: pixelated` wo relevant.

**Fonts** (lokal in `app/public/fonts/`, per `@font-face`):
- `Press Start 2P` (SIL OFL, Google Fonts) für Überschrift, Buttons, Badges — großflächig/kurz eingesetzt, da bei kleiner Schriftgröße schlecht lesbar.
- `VT323` (SIL OFL, Google Fonts) als lesbarer Pixel-Font für Fließtext/Statuszeilen/Log-Viewer (ersetzt dort den bisherigen System-Sans, Log-Viewer bleibt aber `ui-monospace` für saubere Spaltenausrichtung).

**CSS-Block-Icons**: pro Welt-Kachel ein `.block-icon`-Element (ersetzt das bisherige Emoji in `.tile-icon`) — Gras-Block-Optik via zweigeteiltem `linear-gradient` (grüner Top-Streifen, brauner Erde-Body) + Bevel-Shadow. Status beeinflusst die Optik: `running` = kräftiges Gras-Grün, `stopped`/`not_created` = entsättigt/grau, `missing` = rissige/"Bedrock"-graue Variante.

## Datei-Änderungen

- **`app/public/fonts/`** (neu): `PressStart2P-Regular.ttf` und `VT323-Regular.ttf` von `google/fonts` (GitHub, OFL-lizenziert) bezogen. Kein Dockerfile-Änderung nötig (`COPY . .` schließt neue Verzeichnisse automatisch ein).
- **`app/public/style.css`**: größter Teil der Arbeit.
  - `@font-face`-Deklarationen für beide lokalen Fonts.
  - Neue Farbvariablen (Stein/Holz/Gras/Gold/Redstone/Lapis), Entfernen der `prefers-color-scheme`-Media-Query.
  - Body-Hintergrund: Stein-Textur via CSS-Gradients.
  - `.tile`, `.btn`, `.badge`, `.confirm-box`, `.logs-box`: eckige Ecken, Pixel-Bevel-Box-Shadows, Holz-Panel-Hintergrund für Tiles/Dialoge.
  - Neue `.block-icon`-Klasse (ersetzt `.tile-icon`-Emoji-Styling) mit Status-Varianten.
  - Header-Styling: Pixel-Font-Titel mit Minecraft-typischem Text-Shadow (versetzte dunkle Kopie).
- **`app/public/app.js`**: nur `render()` betroffen — `.tile-icon` mit Emoji-Text wird durch ein `.block-icon`-`div` (kein Text-Content, Optik komplett über CSS/Status-Klasse) ersetzt; restliche Logik (Polling, SSE, Confirm-Flow) unverändert.
- **`app/public/index.html`**: minimal — Favicon (kleines Inline-SVG/Emoji-Data-URI, Grasblock-Motiv) ergänzt, Subtitle-Zeile unter dem Header. Keine strukturellen Änderungen an den Overlays (Klassennamen bleiben, nur CSS ändert sich).

## Verifikation

- `docker compose up -d --build`, danach `http://localhost:3000` im Browser öffnen.
- Visuelle Prüfung aller Zustände: `not_created` (Kachel anklicken → Confirm-Dialog im neuen Stil), `starting` (Spinner+Badge), `running` (grüner Rahmen, Stop-Button, Logs-Button), `stopping`, `missing` (rissige Bedrock-Optik + Warnhinweis).
- Logs-Overlay öffnen und prüfen, dass der Log-Text weiterhin gut lesbar bleibt (monospace, nicht Pixel-Font).
- Kurzer Check in Chrome DevTools, dass keine 404s für die Font-Dateien auftreten (Netzwerktab).
- Fenstergröße variieren (Mobile-Breite) um sicherzustellen, dass das Grid/die Kacheln weiterhin responsiv bleiben.
