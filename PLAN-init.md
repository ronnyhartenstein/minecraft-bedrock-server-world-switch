# Minecraft Bedrock Welt-Switcher (Web-UI)

## Context

Aktuell läuft der Minecraft-Bedrock-Server (itzg/minecraft-bedrock-server Image) lokal unter Windows als ein einzelner Docker-Container (`mc-bedrock`), gestartet mit einem festen `docker run`-Befehl (LEVEL_NAME, SERVER_NAME, OPS, DIFFICULTY etc.). Das Kind hat aber mehrere Welten mit unterschiedlichen Mods/Behavior-Packs, die unter `bedrock-server-docker/data/worlds/<weltname>` liegen. Aktuell kann nur eine Welt aktiv sein und ein Wechsel erfordert manuelles Stoppen/Neustarten mit anderen Parametern.

Ziel: Eine kleine, kindgerechte Web-UI (ähnlich einer Realms-Auswahl), über die zwischen den vorhandenen Welten umgeschaltet werden kann. Pro Klick soll der aktuell laufende Container gestoppt und der Container der gewählten Welt gestartet werden. Es darf immer nur ein Minecraft-Server gleichzeitig laufen (gemeinsamer UDP-Port 19132).

Architekturentscheidung (mit Nutzer abgestimmt):
- Ein eigener Docker-Container pro Welt, Name `mc-realm-<weltname>`, es läuft aber nie mehr als einer gleichzeitig.
- Die Web-UI läuft selbst containerisiert und steuert den Docker-Daemon über den gemounteten Docker-Socket (`/var/run/docker.sock`) – das funktioniert auch unter Windows mit Docker Desktop.
- Jede Welt kann individuell konfiguriert werden (eigene ENV-Overrides für GAMEMODE, DIFFICULTY, ALLOW_CHEATS, OPS, ...), nicht nur LEVEL_NAME/SERVER_NAME.
- Kein Login – Bedienung im Heimnetz per Klick, kindgerecht einfach.

Wichtiger technischer Punkt (Docker-outside-of-Docker): Die Web-UI spricht zwar über den gemounteten Socket mit dem Host-Docker-Daemon, aber wenn sie für die `mc-realm-*`-Container einen Volume-Bind für `/data` anlegt, muss dieser Pfad ein **Host-Pfad** sein (der Windows-Docker-Daemon löst Binds relativ zum Host auf, nicht relativ zum UI-Container). Dafür gibt es eine explizite ENV-Variable `HOST_DATA_PATH`, die der Nutzer beim Start der UI auf den absoluten Windows-Pfad zu `bedrock-server-docker/data` setzt. Getrennt davon wird `bedrock-server-docker/data/worlds` read-only in den UI-Container gemountet, nur um die vorhandenen Weltordner aufzulisten.

## Struktur

```
minecraft-bedrock-server-world-switch/
├── docker-compose.yml
├── README.md
└── app/
    ├── Dockerfile
    ├── package.json
    ├── server.js
    ├── src/
    │   ├── docker.js        # dockerode-Wrapper: list/stop/create/start mc-realm-* Container
    │   ├── worlds.js        # Discovery der Weltordner + Laden/Speichern config/worlds.json
    │   └── config.js        # Default-ENV (aus dem bisherigen docker run) + Merge-Logik
    ├── data/
    │   └── worlds.json       # persistierte Konfiguration je Welt (auto-generiert + editierbar)
    └── public/
        ├── index.html        # Kachel-UI: eine Kachel pro Welt
        ├── app.js             # fetch-Aufrufe, Status-Polling, Switch-Flow
        └── style.css
```

## Backend-Design

**`src/config.js`** – globale Default-Werte (aus dem bisherigen `docker run`-Befehl):
```js
{
  OPS: "2535466053468591,2533274817994625",
  DEFAULT_PLAYER_PERMISSION_LEVEL: "operator",
  DIFFICULTY: "easy",
  ONLINE_MODE: "true",
  ALLOW_CHEATS: "true",
  GAMEMODE: "creative",
  EULA: "TRUE"
}
```
Diese Defaults werden pro Welt mit den in `worlds.json` hinterlegten Overrides gemerged (Override gewinnt).

**`src/worlds.js`**
- `discoverWorldFolders()`: liest Unterverzeichnisse von `/worlds` (read-only Mount).
- `loadConfig()` / `saveConfig()`: lädt `data/worlds.json`; für neu gefundene Ordner wird automatisch ein Eintrag angelegt:
  `{ id: slug(folder), folderName: folder, displayName: folder, containerName: "mc-realm-"+slug(folder), env: {} }`.
- Für Ordner, die aus `data/worlds` verschwunden sind, wird der Eintrag nicht automatisch gelöscht (nur als "missing" markiert) – kein Datenverlust bei UI-Anzeige.

**`src/docker.js`** (nutzt `dockerode`, Standard-Unix-Socket `/var/run/docker.sock`)
- `listRealmContainers()`: alle Container mit Namenspräfix `mc-realm-` inkl. Status.
- `getActiveWorldId()`: welcher `mc-realm-*` Container ist `running`.
- `ensureContainerForWorld(worldConfig)`: falls Container nicht existiert → `docker.createContainer` mit
  - `Image: "itzg/minecraft-bedrock-server"`
  - `name: worldConfig.containerName`
  - `Env`: gemergte Defaults + `LEVEL_NAME=<folderName>` + `SERVER_NAME=<displayName>` + Welt-Overrides
  - `HostConfig.Binds: [ HOST_DATA_PATH + ":/data" ]`
  - `HostConfig.PortBindings: { "19132/udp": [{ HostPort: "19132" }] }`
  - `ExposedPorts: { "19132/udp": {} }`
  - `Tty: true, OpenStdin: true` (Äquivalent zu `-it`)
  - `HostConfig.RestartPolicy: { Name: "unless-stopped" }`
  - Label `managed-by=mc-realm-switcher` zur Wiedererkennung.
- `switchToWorld(worldId)`:
  1. Alle laufenden `mc-realm-*`-Container ermitteln, die nicht `worldId` sind → `docker stop` (mit Timeout, damit die Welt sauber speichert).
  2. Zielcontainer sicherstellen (`ensureContainerForWorld`, falls noch nicht angelegt).
  3. Zielcontainer starten (`docker start`).
  4. Ergebnis zurückgeben; Start läuft asynchron weiter, Frontend pollt Status.

**`server.js`** (Express)
- `GET /api/worlds` → Liste aller konfigurierten Welten + aktueller Status (`running` / `stopped` / `starting` / `not_created`).
- `POST /api/worlds/:id/activate` → ruft `switchToWorld` auf, liefert sofort `202 Accepted` zurück (Wechsel läuft im Hintergrund).
- `GET /api/status` → aktuell aktive Welt + Zustand (für Polling).
- Statisches Ausliefern von `public/`.

## Frontend-Design

- `index.html`: Grid aus großen Kacheln (eine je Welt), Name der Welt groß, Status-Badge ("Läuft" grün / "Gestoppt" grau / "Startet…" gelb mit Spinner).
- Klick auf eine nicht-aktive Kachel → kurze Bestätigung ("Zu **Zombie-Welt** wechseln? Der aktuelle Server wird gestoppt.") → `POST /api/worlds/:id/activate`.
- Danach Polling `GET /api/worlds` alle 2s, bis Zielwelt `running` ist (Timeout ~90s mit Fehleranzeige, falls es hängt).
- Kein Login, einfache große Buttons/Kacheln – kindgerecht.

## Docker Compose (UI selbst)

```yaml
services:
  mc-realm-switcher:
    build: ./app
    container_name: mc-realm-switcher
    ports:
      - "3000:3000"
    environment:
      - HOST_DATA_PATH=${HOST_DATA_PATH}   # z.B. C:\Users\...\bedrock-server-docker\data
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./bedrock-server-docker/data/worlds:/worlds:ro
      - ./app/data:/app/data                # persistiert worlds.json
    restart: unless-stopped
```
`HOST_DATA_PATH` wird vom Nutzer in einer `.env`-Datei gesetzt (Windows-Pfad zum `data`-Ordner neben `worlds`).

## README.md

Kurzanleitung: `.env` mit `HOST_DATA_PATH` anlegen, `docker compose up -d --build`, UI unter `http://localhost:3000` öffnen. Hinweis, dass der alte `mc-bedrock`-Container danach manuell entfernt werden kann (`docker rm -f mc-bedrock`), damit kein Port-Konflikt auf 19132/udp entsteht.

## Verifikation

1. `docker compose up -d --build` im Projektverzeichnis, UI unter `http://localhost:3000` aufrufen.
2. Prüfen, dass alle Unterordner aus `bedrock-server-docker/data/worlds` als Kacheln erscheinen.
3. Eine Welt anklicken → Container `mc-realm-<welt>` wird erstellt/gestartet (`docker ps` prüfen), Status in UI wechselt auf "Läuft".
4. Zweite Welt anklicken → erster Container wird gestoppt, zweiter gestartet; sicherstellen, dass nie zwei gleichzeitig laufen (`docker ps` zeigt nur einen `mc-realm-*` im Zustand `running`).
5. Mit Minecraft-Client (oder `nc -u` Port-Check) verbinden und prüfen, dass die richtige Welt mit korrektem `LEVEL_NAME` geladen wird.
6. Docker-Daemon/Windows neu starten und prüfen, dass nur der zuletzt aktive Container automatisch wieder hochkommt (Restart-Policy-Test).
