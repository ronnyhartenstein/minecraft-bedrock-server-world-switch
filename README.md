# Minecraft Bedrock Welt-Switcher

Kleine Web-UI, um zwischen mehreren Minecraft-Bedrock-Welten umzuschalten, ohne von Hand Docker-Befehle tippen zu müssen. Jede Welt läuft in ihrem eigenen Container (`mc-realm-<weltname>`), aber es läuft immer nur einer gleichzeitig (gemeinsamer Port 19132/udp).

## Voraussetzungen

- Docker Desktop unter Windows (mit WSL2- oder Hyper-V-Backend).
- Die vorhandenen Welten liegen unter `bedrock-server-docker/data/worlds/<weltname>` (ein Unterordner pro Welt).

## Einrichtung

1. Diesen Projektordner (`minecraft-bedrock-server-world-switch`) so ablegen, dass der `bedrock-server-docker`-Ordner mit den Welten daneben liegt - oder den Pfad über `WORLDS_DIR` anpassen (siehe unten).

2. `.env` aus der Vorlage anlegen:

   ```powershell
   copy .env.example .env
   ```

3. In `.env` `HOST_DATA_PATH` auf den **absoluten Windows-Pfad** zum `data`-Ordner setzen (Elternordner von `worlds`), z.B.:

   ```
   HOST_DATA_PATH=C:\Users\ronny\bedrock-server-docker\data
   ```

   Das ist wichtig: Die UI läuft selbst in einem Container und steuert den Docker-Daemon über den gemounteten Docker-Socket. Wenn sie neue Minecraft-Container anlegt, muss sie dem Daemon einen Pfad nennen, den **der Daemon** (also der Host) versteht - nicht den Pfad, wie ihn die UI selbst intern sieht.

4. Optional: Falls `bedrock-server-docker/data/worlds` nicht direkt neben diesem Projekt liegt, in `.env` zusätzlich setzen:

   ```
   WORLDS_DIR=D:\irgendwo\bedrock-server-docker\data\worlds
   ```

5. Starten:

   ```powershell
   docker compose up -d --build
   ```

6. UI öffnen: [http://localhost:3000](http://localhost:3000)

Beim ersten Start werden alle vorhandenen Weltordner automatisch erkannt und mit Standard-Einstellungen (aus dem bisherigen `docker run`-Befehl) in `app/data/worlds.json` angelegt. Diese Datei kann danach angepasst werden, um z.B. für einzelne Welten andere Werte für `GAMEMODE`, `DIFFICULTY`, `ALLOW_CHEATS` oder `OPS` zu setzen (siehe Beispiel unten). Nach einer Änderung an `env` muss der zugehörige Container einmal manuell gelöscht werden (`docker rm -f mc-realm-<id>`), damit er beim nächsten Wechsel mit den neuen Werten neu angelegt wird.

```json
{
  "id": "zombie",
  "folderName": "Zombie",
  "displayName": "Zombie-Welt",
  "containerName": "mc-realm-zombie",
  "env": {
    "GAMEMODE": "survival",
    "DIFFICULTY": "hard"
  }
}
```

## Alten Einzel-Container entfernen

Der bisherige Container (`mc-bedrock`) belegt denselben Port und sollte gestoppt/entfernt werden, bevor die erste Welt über die neue UI gestartet wird:

```powershell
docker rm -f mc-bedrock
```

## Funktionsweise

- Die UI (Container `realm-switcher-ui`, bewusst *nicht* mit `mc-realm-` Präfix benannt, damit sie sich nicht selbst als Welt-Container erkennt) läuft als eigener Container, gemountet mit dem Docker-Socket (`/var/run/docker.sock`) sowie read-only mit dem `worlds`-Ordner (nur zum Auflisten der vorhandenen Welten).
- Klick auf eine Welt-Kachel → aktuell laufender `mc-realm-*`-Container wird gestoppt, der Ziel-Container erstellt (falls noch nicht vorhanden) und gestartet.
- Alle `mc-realm-*`-Container teilen sich denselben `-v <data>:/data`-Mount wie der bisherige Server; `LEVEL_NAME` (= Weltordnername) sorgt dafür, dass jeweils die richtige Welt geladen wird.
- Restart-Policy `unless-stopped`: Nach einem Windows-/Docker-Neustart startet automatisch wieder die zuletzt aktive Welt.

## API

- `GET /api/worlds` - Liste aller Welten mit Status (`running`, `stopped`, `starting`, `not_created`).
- `POST /api/worlds/:id/activate` - wechselt zur angegebenen Welt (asynchron, Status per Polling abfragen).
- `GET /api/status` - aktuell aktive Welt.
