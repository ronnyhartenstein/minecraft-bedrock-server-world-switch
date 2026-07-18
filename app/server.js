const path = require("path");
const { StringDecoder } = require("string_decoder");
const express = require("express");

const { PORT } = require("./src/config");
const { syncWorlds, loadConfig } = require("./src/worlds");
const { switchToWorld, stopWorld, streamLogs, getStatusByContainerName } = require("./src/docker");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Tracks a world that is currently switching to / being stopped, so the UI
// can show "starting..." / "stopping..." before the container reflects it.
let switching = null;
let stopping = null;

async function worldsWithStatus() {
  const worlds = syncWorlds();
  const statusByName = await getStatusByContainerName();
  return worlds.map((world) => {
    const dockerState = statusByName.get(world.containerName); // undefined if never created
    let status = "not_created";
    if (dockerState === "running") status = "running";
    else if (dockerState) status = "stopped";
    if (switching === world.id && status !== "running") status = "starting";
    if (stopping === world.id && status === "running") status = "stopping";
    return { ...world, status };
  });
}

app.get("/api/worlds", async (req, res) => {
  try {
    res.json(await worldsWithStatus());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/status", async (req, res) => {
  try {
    const worlds = await worldsWithStatus();
    const active = worlds.find(
      (w) => w.status === "running" || w.status === "starting" || w.status === "stopping"
    );
    res.json({ activeWorldId: active ? active.id : null, worlds });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/worlds/:id/activate", async (req, res) => {
  const { worlds } = loadConfig();
  const world = worlds.find((w) => w.id === req.params.id);
  if (!world) return res.status(404).json({ error: "Welt nicht gefunden" });
  if (world.missing) {
    return res.status(409).json({ error: "Weltordner existiert nicht mehr" });
  }

  res.status(202).json({ ok: true });

  switching = world.id;
  try {
    await switchToWorld(world);
  } catch (err) {
    console.error(`Fehler beim Wechsel zu ${world.id}:`, err.message);
  } finally {
    switching = null;
  }
});

app.post("/api/worlds/:id/stop", async (req, res) => {
  const { worlds } = loadConfig();
  const world = worlds.find((w) => w.id === req.params.id);
  if (!world) return res.status(404).json({ error: "Welt nicht gefunden" });

  res.status(202).json({ ok: true });

  stopping = world.id;
  try {
    await stopWorld(world);
  } catch (err) {
    console.error(`Fehler beim Stoppen von ${world.id}:`, err.message);
  } finally {
    stopping = null;
  }
});

app.get("/api/worlds/:id/logs", async (req, res) => {
  const { worlds } = loadConfig();
  const world = worlds.find((w) => w.id === req.params.id);
  if (!world) return res.status(404).end();

  let dockerStream;
  try {
    dockerStream = await streamLogs(world);
  } catch (err) {
    console.error(`Log-Stream-Fehler für ${world.id}:`, err.message);
    return res.status(500).end();
  }
  if (!dockerStream) return res.status(404).end();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  // Docker log chunks don't align to line boundaries, and a chunk can end
  // mid-UTF-8-character (e.g. umlauts in player names) - StringDecoder
  // handles that incrementally. Buffer up to the next newline and emit one
  // SSE `data:` frame per complete line.
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  const onData = (chunk) => {
    buffer += decoder.write(chunk);
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      res.write(`data: ${line}\n\n`);
    }
  };

  const ping = setInterval(() => res.write(": ping\n\n"), 20_000);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(ping);
    dockerStream.off("data", onData);
    dockerStream.off("end", onEnd);
    dockerStream.off("error", onError);
    dockerStream.destroy();
  };
  const onEnd = () => {
    res.write("event: ended\ndata: stream ended\n\n");
    cleanup();
    res.end();
  };
  const onError = (err) => {
    console.error(`Log-Stream für ${world.id} unterbrochen:`, err.message);
    cleanup();
    res.end();
  };

  dockerStream.on("data", onData);
  dockerStream.on("end", onEnd);
  dockerStream.on("error", onError);
  req.on("close", cleanup);
});

app.listen(PORT, () => {
  console.log(`mc-realm-switcher listening on port ${PORT}`);
});
