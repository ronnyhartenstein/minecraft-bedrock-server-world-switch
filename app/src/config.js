const IMAGE = "itzg/minecraft-bedrock-server";
const CONTAINER_PREFIX = "mc-realm-";
const MANAGED_LABEL = "managed-by";
const MANAGED_LABEL_VALUE = "mc-realm-switcher";
const UDP_PORT = "19132/udp";

// Defaults taken from the previous single-container `docker run` command.
// Per-world overrides in worlds.json win over these.
const DEFAULT_ENV = {
  OPS: "2535466053468591,2533274817994625",
  DEFAULT_PLAYER_PERMISSION_LEVEL: "operator",
  DIFFICULTY: "easy",
  ONLINE_MODE: "true",
  ALLOW_CHEATS: "true",
  GAMEMODE: "creative",
  EULA: "TRUE",
};

const HOST_DATA_PATH = process.env.HOST_DATA_PATH;
const WORLDS_MOUNT = process.env.WORLDS_MOUNT || "/worlds";
const CONFIG_FILE = process.env.CONFIG_FILE || "/app/data/worlds.json";
const PORT = process.env.PORT || 3000;

module.exports = {
  IMAGE,
  CONTAINER_PREFIX,
  MANAGED_LABEL,
  MANAGED_LABEL_VALUE,
  UDP_PORT,
  DEFAULT_ENV,
  HOST_DATA_PATH,
  WORLDS_MOUNT,
  CONFIG_FILE,
  PORT,
};
