const os = require("os");
const Docker = require("dockerode");
const {
  IMAGE,
  CONTAINER_PREFIX,
  MANAGED_LABEL,
  MANAGED_LABEL_VALUE,
  UDP_PORT,
  DEFAULT_ENV,
  HOST_DATA_PATH,
} = require("./config");

const docker = new Docker(); // talks to /var/run/docker.sock

// Docker sets a container's hostname to its own (short) container ID unless
// overridden. Used to make sure this UI never lists/stops itself, even if
// its own container name ever ends up matching CONTAINER_PREFIX.
const OWN_HOSTNAME = os.hostname();

function envListFor(world) {
  const merged = { ...DEFAULT_ENV, ...(world.env || {}) };
  merged.LEVEL_NAME = world.folderName;
  merged.SERVER_NAME = world.displayName;
  return Object.entries(merged).map(([key, value]) => `${key}=${value}`);
}

// Lists every mc-realm-* container (running or not), regardless of whether
// it's still referenced in worlds.json. Excludes this UI's own container.
async function listRealmContainers() {
  const containers = await docker.listContainers({ all: true });
  return containers.filter(
    (c) =>
      c.Names.some((n) => n.replace(/^\//, "").startsWith(CONTAINER_PREFIX)) &&
      !c.Id.startsWith(OWN_HOSTNAME)
  );
}

function containerNameOf(containerInfo) {
  return containerInfo.Names[0].replace(/^\//, "");
}

async function getStatusByContainerName() {
  const containers = await listRealmContainers();
  const statusByName = new Map();
  for (const c of containers) {
    statusByName.set(containerNameOf(c), c.State); // "running", "exited", "created", ...
  }
  return statusByName;
}

async function findContainerByName(name) {
  const containers = await listRealmContainers();
  const match = containers.find((c) => containerNameOf(c) === name);
  return match ? docker.getContainer(match.Id) : null;
}

async function ensureContainerForWorld(world) {
  const existing = await findContainerByName(world.containerName);
  if (existing) return existing;

  if (!HOST_DATA_PATH) {
    throw new Error(
      "HOST_DATA_PATH is not set - cannot create a new world container without knowing the host path to the data directory."
    );
  }

  const created = await docker.createContainer({
    Image: IMAGE,
    name: world.containerName,
    Tty: true,
    OpenStdin: true,
    Env: envListFor(world),
    ExposedPorts: { [UDP_PORT]: {} },
    Labels: { [MANAGED_LABEL]: MANAGED_LABEL_VALUE },
    HostConfig: {
      Binds: [`${HOST_DATA_PATH}:/data`],
      PortBindings: { [UDP_PORT]: [{ HostPort: "19132" }] },
      RestartPolicy: { Name: "unless-stopped" },
    },
  });
  return created;
}

async function stopContainer(containerId, timeoutSeconds = 30) {
  const container = docker.getContainer(containerId);
  try {
    await container.stop({ t: timeoutSeconds });
  } catch (err) {
    // 304 = already stopped, nothing to do
    if (err.statusCode !== 304) throw err;
  }
}

async function switchToWorld(world) {
  const containers = await listRealmContainers();
  const running = containers.filter(
    (c) => c.State === "running" && containerNameOf(c) !== world.containerName
  );
  for (const c of running) {
    await stopContainer(c.Id);
  }

  const target = await ensureContainerForWorld(world);
  await target.start().catch((err) => {
    if (err.statusCode !== 304) throw err; // 304 = already started
  });
}

// Stops a world's container without starting anything else, i.e. turns the
// server off entirely. RestartPolicy "unless-stopped" honors this: an
// explicit stop keeps it off even across a Docker/Windows restart.
async function stopWorld(world) {
  const container = await findContainerByName(world.containerName);
  if (!container) return;
  await stopContainer(container.id);
}

module.exports = {
  docker,
  listRealmContainers,
  getStatusByContainerName,
  ensureContainerForWorld,
  switchToWorld,
  stopWorld,
};
