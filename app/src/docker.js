const os = require("os");
const Docker = require("dockerode");
const {
  IMAGE,
  CONTAINER_PREFIX,
  MANAGED_LABEL,
  MANAGED_LABEL_VALUE,
  SERVER_PORTS,
  DEFAULT_ENV,
  HOST_DATA_PATH,
  LOG_TAIL_LINES,
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

// Port bindings can't be changed on an existing container, so one created
// before SERVER_PORTS changed has to be replaced. World data is safe: it lives
// in the /data bind mount, not in the container.
async function hasCurrentPortBindings(container) {
  const info = await container.inspect();
  const bindings = info.HostConfig.PortBindings || {};
  return SERVER_PORTS.every((port) => bindings[port]);
}

async function ensureContainerForWorld(world) {
  const existing = await findContainerByName(world.containerName);
  if (existing) {
    if (await hasCurrentPortBindings(existing)) return existing;
    await stopContainer(existing.id);
    await existing.remove();
  }

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
    ExposedPorts: Object.fromEntries(SERVER_PORTS.map((port) => [port, {}])),
    Labels: { [MANAGED_LABEL]: MANAGED_LABEL_VALUE },
    HostConfig: {
      Binds: [`${HOST_DATA_PATH}:/data`],
      PortBindings: Object.fromEntries(
        SERVER_PORTS.map((port) => [port, [{ HostPort: "19132" }]])
      ),
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

// Briefly polls for a world's container to exist. Needed because the
// frontend opens the log stream right after POST /activate, but
// switchToWorld() may still be stopping the previous world's container
// (up to a 30s grace timeout) before the new one gets created.
async function waitForContainer(world, { retries = 10, intervalMs = 500 } = {}) {
  for (let i = 0; i < retries; i++) {
    const container = await findContainerByName(world.containerName);
    if (container) return container;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

// Live log stream for a world's container. Containers are created with
// Tty: true (see ensureContainerForWorld), so logs({follow:true}) resolves
// to a plain-text byte stream - no stdout/stderr demuxing needed. Returns
// null if the container still doesn't exist after the retry budget.
async function streamLogs(world, { tail = LOG_TAIL_LINES } = {}) {
  const container = await waitForContainer(world);
  if (!container) return null;
  return container.logs({ follow: true, stdout: true, stderr: true, tail });
}

module.exports = {
  docker,
  listRealmContainers,
  getStatusByContainerName,
  ensureContainerForWorld,
  switchToWorld,
  stopWorld,
  streamLogs,
};
