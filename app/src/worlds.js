const fs = require("fs");
const path = require("path");
const { CONTAINER_PREFIX, WORLDS_MOUNT, CONFIG_FILE } = require("./config");

function slug(name) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics (ä -> a etc.)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "welt";
}

function discoverWorldFolders() {
  if (!fs.existsSync(WORLDS_MOUNT)) return [];
  return fs
    .readdirSync(WORLDS_MOUNT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return { worlds: [] };
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.worlds)) return { worlds: [] };
    return parsed;
  } catch (err) {
    console.error(`Failed to read ${CONFIG_FILE}, starting fresh:`, err.message);
    return { worlds: [] };
  }
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf8");
}

// Reconciles worlds.json with the folders actually present under /worlds:
// adds newly discovered worlds with sane defaults, flags worlds whose
// folder disappeared (without deleting their config), and clears that
// flag if the folder comes back.
function syncWorlds() {
  const config = loadConfig();
  const folders = discoverWorldFolders();
  const byFolder = new Map(config.worlds.map((w) => [w.folderName, w]));

  for (const folder of folders) {
    if (!byFolder.has(folder)) {
      const id = slug(folder);
      const entry = {
        id,
        folderName: folder,
        displayName: folder,
        containerName: `${CONTAINER_PREFIX}${id}`,
        env: {},
        missing: false,
      };
      config.worlds.push(entry);
      byFolder.set(folder, entry);
    } else {
      byFolder.get(folder).missing = false;
    }
  }

  const foldersSet = new Set(folders);
  for (const world of config.worlds) {
    if (!foldersSet.has(world.folderName)) {
      world.missing = true;
    }
  }

  saveConfig(config);
  return config.worlds;
}

module.exports = {
  slug,
  discoverWorldFolders,
  loadConfig,
  saveConfig,
  syncWorlds,
};
