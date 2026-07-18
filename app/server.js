const path = require("path");
const express = require("express");

const { PORT } = require("./src/config");
const { syncWorlds, loadConfig } = require("./src/worlds");
const { switchToWorld, getStatusByContainerName } = require("./src/docker");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Tracks a world that is currently switching to, so the UI can show
// "starting..." even before the container reaches "running" state.
let switching = null;

async function worldsWithStatus() {
  const worlds = syncWorlds();
  const statusByName = await getStatusByContainerName();
  return worlds.map((world) => {
    const dockerState = statusByName.get(world.containerName); // undefined if never created
    let status = "not_created";
    if (dockerState === "running") status = "running";
    else if (dockerState) status = "stopped";
    if (switching === world.id && status !== "running") status = "starting";
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
    const active = worlds.find((w) => w.status === "running" || w.status === "starting");
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

app.listen(PORT, () => {
  console.log(`mc-realm-switcher listening on port ${PORT}`);
});
