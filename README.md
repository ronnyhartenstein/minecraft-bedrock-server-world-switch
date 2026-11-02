# Minecraft Bedrock Welt-Switcher

Kleine Web-UI, um zwischen mehreren Minecraft-Bedrock-Welten umzuschalten, ohne von Hand Docker-Befehle tippen zu müssen. Jede Welt läuft in ihrem eigenen Container (`mc-realm-<weltname>`), aber es läuft immer nur einer gleichzeitig (gemeinsamer Port 19132 für TCP und UDP).

## Voraussetzungen

- Windows 11 mit Docker Desktop (WSL2-Backend empfohlen, funktioniert aber auch mit Hyper-V).
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

## Hinweise für Windows 11

- **Docker Desktop muss laufen, bevor `docker compose up` ausgeführt wird**, und für automatisches Hochfahren nach einem Windows-Neustart unter *Settings → General* die Option „Start Docker Desktop when you sign in“ aktivieren. Nur so greift die `restart: unless-stopped`-Policy zuverlässig (Docker selbst startet den zuletzt aktiven Welt-Container erst, wenn der Daemon wieder läuft).
- **Docker-Socket-Mount funktioniert auf Windows transparent**: `/var/run/docker.sock` wird von Docker Desktop automatisch auf den internen Named-Pipe-Mechanismus (`\\.\pipe\docker_engine`) gemappt - dafür ist keine zusätzliche Konfiguration nötig, es muss aber Docker **Desktop** sein (nicht ein reiner WSL2-Docker-Engine ohne Desktop-Integration).
- **File Sharing**: Liegt dieses Projekt bzw. der `bedrock-server-docker`-Ordner außerhalb des Standard-Nutzerverzeichnisses (`C:\Users\...`), z.B. auf einem anderen Laufwerk, muss der jeweilige Pfad unter *Settings → Resources → File Sharing* freigegeben werden, sonst schlägt der Bind-Mount mit einem Berechtigungsfehler fehl.
- **`HOST_DATA_PATH`-Format**: Läuft `docker compose` direkt aus PowerShell/CMD heraus, den Windows-Pfad mit Backslashes verwenden (`C:\Users\ronny\bedrock-server-docker\data`). Wird stattdessen aus einer WSL2-Shell heraus gearbeitet (das Projekt liegt im Linux-Dateisystem von WSL), stattdessen den WSL-Pfad eintragen (siehe Beispiel in `.env.example`) - Docker Desktop löst beide Formen zum jeweils "richtigen" Host-Pfad auf, aber nur passend zu der Umgebung, aus der `docker compose` gestartet wird.
- **Firewall**: Beim ersten Start fragt Windows meist nach, ob Docker Desktop / `com.docker.backend.exe` im Netzwerk kommunizieren darf - das bestätigen. Damit das Kind von einem anderen Gerät im Heimnetz auf die Welt-Kacheln (`http://<windows-rechner-ip>:3000`) und den Minecraft-Server selbst (UDP 19132) zugreifen kann, müssen in der Windows-Firewall eingehende Verbindungen auf TCP 3000 und UDP 19132 erlaubt sein (Docker Desktop legt die Regel für gemappte Ports meist automatisch an; falls nicht, manuell über *Windows Defender Firewall → Erweiterte Einstellungen → Eingehende Regeln* ergänzen).
- Zugriff vom Kind-Gerät erfolgt über die **lokale IP des Windows-Rechners**, nicht `localhost` (z.B. `http://192.168.1.23:3000`) - IP z.B. per `ipconfig` ermitteln. Am einfachsten fest per DHCP-Reservierung oder statischer IP vergeben, damit sich die Adresse nicht ändert.

## Alten Einzel-Container entfernen

Der bisherige Container (`mc-bedrock`) belegt denselben Port und sollte gestoppt/entfernt werden, bevor die erste Welt über die neue UI gestartet wird:

```powershell
docker rm -f mc-bedrock
```

## Funktionsweise

- Die UI (Container `realm-switcher-ui`, bewusst *nicht* mit `mc-realm-` Präfix benannt, damit sie sich nicht selbst als Welt-Container erkennt) läuft als eigener Container, gemountet mit dem Docker-Socket (`/var/run/docker.sock`) sowie read-only mit dem `worlds`-Ordner (nur zum Auflisten der vorhandenen Welten).
- Klick auf eine Welt-Kachel → aktuell laufender `mc-realm-*`-Container wird gestoppt, der Ziel-Container erstellt (falls noch nicht vorhanden) und gestartet.
- Die laufende Welt hat zusätzlich einen "Stoppen"-Button, um den Server komplett auszuschalten, ohne eine andere Welt zu starten (z.B. wenn niemand spielt). Dank `RestartPolicy: unless-stopped` bleibt sie danach auch nach einem Windows-/Docker-Neustart aus, bis sie wieder aktiv gestartet wird.
- Jede Welt mit existierendem Container (egal ob `running`, `starting`, `stopping` oder `stopped`) hat einen "Logs"-Button, der die Container-Logs live streamt (Server-Sent Events) - direkt nach dem Start einer Welt öffnet sich dieses Log-Fenster automatisch, damit man am Boot-Fortschritt erkennt, wann der Bedrock-Server wirklich spielbereit ist (Docker-Status "running" heißt nur, dass der Container läuft, nicht dass der Server fertig geladen hat).
- Alle `mc-realm-*`-Container teilen sich denselben `-v <data>:/data`-Mount wie der bisherige Server; `LEVEL_NAME` (= Weltordnername) sorgt dafür, dass jeweils die richtige Welt geladen wird.
- Restart-Policy `unless-stopped`: Nach einem Windows-/Docker-Neustart startet automatisch wieder die zuletzt aktive Welt.

## API

- `GET /api/worlds` - Liste aller Welten mit Status (`running`, `stopped`, `starting`, `stopping`, `not_created`).
- `POST /api/worlds/:id/activate` - wechselt zur angegebenen Welt (asynchron, Status per Polling abfragen).
- `POST /api/worlds/:id/stop` - stoppt die angegebene Welt, ohne eine andere zu starten (asynchron).
- `GET /api/status` - aktuell aktive Welt.
- `GET /api/worlds/:id/logs` - Live-Log-Stream der Welt als Server-Sent Events (`EventSource` im Browser); `404`, falls die Welt keinen Container hat.
