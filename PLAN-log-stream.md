# Feature: Live-Log-Stream für die gestartete Welt

## Context

Der Minecraft-Bedrock-Welt-Switcher (`/Users/ronny/dev/minecraft-bedrock-server-world-switch`) kann Welten starten/stoppen, aber nach einem Start sieht man nur einen Spinner mit Status "Startet…", bis der Container als `running` gemeldet wird. Das sagt nichts darüber aus, ob der Bedrock-Server *im Container* tatsächlich schon spielbereit ist (Docker "running" ≠ Minecraft-Server hat fertig geladen). Der Nutzer möchte das Container-Log als Live-Stream sehen können, um abzuschätzen, wann der Server wirklich läuft (das itzg-Image schreibt Boot-Fortschritt und eine finale "Server started."-Zeile ins Log).

Ziel: Ein Log-Viewer in der Web-UI, der die Docker-Logs einer Welt live streamt — insbesondere automatisch direkt nach dem Start einer Welt geöffnet, damit man den Boot-Fortschritt live mitverfolgen kann.

## Architekturentscheidung

**Server-Sent Events** (natives `EventSource` im Browser) statt WebSocket — passt zum bestehenden minimalen Stack (nur `express` + `dockerode`, kein Build-Schritt, kein `ws`), da nur eine Richtung (Server→Client) gebraucht wird. Die Welt-Container laufen mit `Tty: true` (siehe `ensureContainerForWorld` in `app/src/docker.js`), daher liefert `container.logs({follow:true})` einen reinen Text-Byte-Stream ohne Multiplexing/Demuxing.

Keine Kompression/Reverse-Proxy im Weg (server.js nutzt nur `express.json()`/`express.static()`, `docker-compose.yml` published Port 3000 direkt) — SSE funktioniert ohne Sonderbehandlung.

## Backend

**`app/src/config.js`**: neue Konstante `LOG_TAIL_LINES = 200` (Zeilen Vorgeschichte beim Öffnen des Streams) exportieren.

**`app/src/docker.js`**: zwei neue Funktionen, exportiert:
- `waitForContainer(world, {retries=10, intervalMs=500})`: pollt `findContainerByName` kurz, um das Race zwischen `POST /activate` (Container wird evtl. erst nach Sekunden angelegt, da `switchToWorld` zuerst den alten Container mit bis zu 30s Grace-Timeout stoppt) und dem *automatischen* Öffnen des Log-Viewers direkt nach dem Start abzufedern. Ohne das würde ein sofortiger Verbindungsversuch auf einen noch nicht existierenden Container treffen → `404` → `EventSource` gibt laut Spec bei einem echten HTTP-Fehler dauerhaft auf (kein Auto-Reconnect).
- `streamLogs(world, {tail=LOG_TAIL_LINES})`: `waitForContainer` → `container.logs({follow:true, stdout:true, stderr:true, tail})` → gibt den Stream zurück (oder `null`, wenn der Container auch nach der Wartezeit nicht existiert).

**`app/server.js`**: neue Route `GET /api/worlds/:id/logs` (SSE):
- Welt aus `loadConfig()` auflösen (404 falls unbekannt), `streamLogs(world)` aufrufen.
- Bei `null` → `404` (kein Container vorhanden → bewusst kein Reconnect-Loop).
- Sonst: `res.writeHead(200, {"Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no"})`, `res.flushHeaders()`.
- Docker-Log-Chunks kommen nicht zeilenweise an → mit einem `StringDecoder("utf8")` (aus Node `string_decoder`) inkrementell dekodieren (verhindert kaputte Umlaute bei Chunk-Grenzen mitten in einem Mehrbyte-Zeichen, z.B. in Spielernamen/Chat-Zeilen) und an `\n` puffern; jede vollständige Zeile als eigener `data: <zeile>\n\n`-Frame senden.
- Alle 20s eine Kommentarzeile `: ping\n\n` senden (billige Absicherung gegen künftige Timeouts, z.B. falls später ein Reverse-Proxy dazukommt).
- Wenn der Docker-Stream endet (Container läuft nicht mehr / nie gestartet) → eigenes SSE-Event `event: ended\ndata: stream ended\n\n` senden, dann `res.end()`.
- **Wichtig gegen Leaks**: `req.on("close", cleanup)` registrieren — greift bei explizitem `EventSource.close()`, Tab-Schließen oder Netzwerkabbruch gleichermaßen und ruft `dockerStream.destroy()` auf. `cleanup()` muss idempotent sein (wird ggf. sowohl von `req.close` als auch vom Stream-eigenen `end`/`error` aus aufgerufen).

## Frontend

**`app/public/index.html`**: neues, zweites Overlay (unabhängig vom bestehenden `#confirm-overlay`, da dessen `confirmAction()`-Helper auf Ja/Nein zugeschnitten ist):
```html
<div id="logs-overlay" class="overlay hidden">
  <div class="logs-box">
    <div class="logs-header">
      <span id="logs-title"></span>
      <button id="logs-close" class="btn">Schließen</button>
    </div>
    <pre id="log-content" class="log-content"></pre>
  </div>
</div>
```

**`app/public/app.js`**:
- Neuer "Logs"-Button auf jeder Kachel, deren Status einen existierenden Container voraussetzt: `running`, `starting`, `stopping`, `stopped` (bewusst auch `stopped`, damit man nach einem Absturz die letzten Log-Zeilen sehen kann — kostet nichts extra, da das Backend ohnehin nur prüft, ob der Container existiert). `not_created` und Welten ohne Container bekommen keinen Button. Der Button braucht `e.stopPropagation()`, da die `stopped`-Kachel gleichzeitig per Klick den Start auslöst.
- `openLogs(world)` / `closeLogs()`: verwaltet ein `EventSource`-Objekt (`logSource`), schließt eine evtl. schon offene Verbindung beim Öffnen einer neuen. `onmessage` hängt Zeilen an `#log-content` an; Auto-Scroll nur wenn vorher schon am unteren Rand (nicht wegreißen, wenn hochgescrollt wurde); Zeilen-Historie im DOM auf ~2000 Zeilen deckeln.
- **Automatisches Öffnen**: in `confirmSwitch()`, direkt nach dem `POST /activate`-Aufruf, `openLogs(world)` auslösen — das ist der eigentliche Nutzen für "abschätzen wann der Server läuft". Kollidiert nicht mit dem bestehenden Bestätigungs-Overlay, da `confirmAction()` dieses schon vor dem `onConfirm()`-Callback ausblendet. Der bestehende 2s-Polling-Loop (`refresh()`) läuft unverändert weiter.
- Kein spezielles `onerror`-Handling nötig: `EventSource` reconnected automatisch bei einem sauber beendeten Stream (z.B. Container noch nicht gestartet, oder gestoppt) — das ist erwünschtes Verhalten und deckt "Container existiert, läuft aber (noch) nicht" ab, ohne Zusatzcode. Ein echter `404` (Container existiert gar nicht) lässt `EventSource` dagegen laut Spec endgültig aufgeben — genau das soll bei einer wirklich nie gestarteten Welt passieren.

**`app/public/style.css`**: `.logs-box`, `.logs-header`, `.log-content` (dunkler Terminal-Look, monospace, `overflow-y: auto`, bewusst unabhängig vom Light/Dark-Theme immer dunkel), `.btn-logs`.

## Edge Cases (siehe Tabelle aus Plan-Review)

- Welt ohne Container: kein Button, direkter Request → 404 → kein Reconnect.
- Container existiert, nie gestartet: Stream endet sofort (EOF) → `ended`-Event → EventSource reconnected automatisch alle ~3s, bis der Container läuft.
- Auto-Open-Race direkt nach `/activate`: durch `waitForContainer` serverseitig abgefangen.
- Tab schließen / Overlay schließen: beides beendet die HTTP-Verbindung → `req.on("close")` räumt den Docker-Stream auf.
- Wechsel zu einer anderen Welt während Logs offen sind: `openLogs()` schließt eine bestehende Verbindung immer zuerst.

## Verifikation

1. Backend-Syntax-Check (`node --check`) für `server.js`, `src/docker.js`, `src/config.js`, `public/app.js` über einen `node:20-alpine`-Container (wie bei den vorherigen Features).
2. End-to-End-Smoketest wie zuvor: Fake-Image, das kontinuierlich Zeilen ins Log schreibt (z.B. `while true; do echo "tick $(date)"; sleep 1; done`), Welt starten, prüfen dass `curl -N http://localhost:PORT/api/worlds/<id>/logs` laufend Zeilen liefert.
3. Verbindungsabbruch testen: `curl -N` mit Ctrl-C abbrechen, prüfen dass kein Docker-Log-Prozess/-Stream hängen bleibt (z.B. keine wachsende Zahl offener Verbindungen bei wiederholtem Öffnen/Schließen).
4. Im Browser: Welt starten → Log-Overlay öffnet sich automatisch, Zeilen laufen live durch, "Schließen" beendet den Stream sauber. Kachel im Zustand `stopped`/`running` → "Logs"-Button zeigt Historie.
5. README.md / CLAUDE.md um den neuen Endpoint und das SSE-Verhalten ergänzen (analog zu den bisherigen Feature-Dokumentationen).
