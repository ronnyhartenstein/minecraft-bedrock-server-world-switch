const worldsEl = document.getElementById("worlds");
const overlay = document.getElementById("confirm-overlay");
const confirmText = document.getElementById("confirm-text");
const confirmYes = document.getElementById("confirm-yes");
const confirmNo = document.getElementById("confirm-no");

const STATUS_LABELS = {
  running: "Läuft",
  stopped: "Gestoppt",
  starting: "Startet…",
  stopping: "Wird gestoppt…",
  not_created: "Noch nie gestartet",
};

let pollTimer = null;
let pendingId = null; // world.id currently switching-to or being stopped
let pendingDeadline = null;
let pendingKind = null; // "start" | "stop"

function render(worlds) {
  worldsEl.innerHTML = "";
  if (!worlds.length) {
    worldsEl.innerHTML = '<p class="loading">Keine Welten gefunden.</p>';
    return;
  }

  for (const world of worlds) {
    const tile = document.createElement("div");
    tile.className = `tile ${world.status === "running" ? "running" : ""} ${
      world.missing ? "disabled" : ""
    }`;

    const icon = document.createElement("div");
    icon.className = "tile-icon";
    icon.textContent = world.status === "running" ? "🟢" : "🌍";
    tile.appendChild(icon);

    const name = document.createElement("div");
    name.className = "tile-name";
    name.textContent = world.displayName;
    tile.appendChild(name);

    const badge = document.createElement("div");
    badge.className = `badge ${world.status}`;
    if (world.status === "starting" || world.status === "stopping") {
      const spinner = document.createElement("span");
      spinner.className = "spinner";
      badge.appendChild(spinner);
    }
    badge.append(STATUS_LABELS[world.status] || world.status);
    tile.appendChild(badge);

    if (world.missing) {
      const warn = document.createElement("div");
      warn.textContent = "Ordner fehlt";
      warn.style.color = "#c0392b";
      warn.style.fontSize = "0.85rem";
      tile.appendChild(warn);
    }

    if (world.status === "running") {
      const stopBtn = document.createElement("button");
      stopBtn.className = "btn btn-stop";
      stopBtn.textContent = "Stoppen";
      stopBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        confirmStop(world);
      });
      tile.appendChild(stopBtn);
    } else if (!world.missing && world.status !== "starting" && world.status !== "stopping") {
      tile.addEventListener("click", () => confirmSwitch(world, worlds));
    }

    worldsEl.appendChild(tile);
  }
}

async function fetchWorlds() {
  const res = await fetch("/api/worlds");
  if (!res.ok) throw new Error("Konnte Welten nicht laden");
  return res.json();
}

async function refresh() {
  try {
    const worlds = await fetchWorlds();
    render(worlds);

    if (pendingId) {
      const target = worlds.find((w) => w.id === pendingId);
      const done =
        (pendingKind === "start" && target && target.status === "running") ||
        (pendingKind === "stop" && target && target.status !== "running" && target.status !== "stopping");
      if (done) {
        pendingId = null;
        pendingKind = null;
      } else if (Date.now() > pendingDeadline) {
        pendingId = null;
        pendingKind = null;
        worldsEl.insertAdjacentHTML(
          "afterbegin",
          '<p class="error">Das dauert ungewöhnlich lange – bitte prüfen.</p>'
        );
      }
    }
  } catch (err) {
    worldsEl.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

function confirmAction(text, onConfirm) {
  confirmText.textContent = text;
  overlay.classList.remove("hidden");

  const onYes = async () => {
    overlay.classList.add("hidden");
    cleanup();
    await onConfirm();
    refresh();
  };
  const onNo = () => {
    overlay.classList.add("hidden");
    cleanup();
  };
  function cleanup() {
    confirmYes.removeEventListener("click", onYes);
    confirmNo.removeEventListener("click", onNo);
  }
  confirmYes.addEventListener("click", onYes);
  confirmNo.addEventListener("click", onNo);
}

function confirmSwitch(world, allWorlds) {
  const runningElsewhere = allWorlds.some((w) => w.status === "running" && w.id !== world.id);
  const text = runningElsewhere
    ? `Zu "${world.displayName}" wechseln? Der aktuell laufende Server wird gestoppt.`
    : `"${world.displayName}" starten?`;

  confirmAction(text, async () => {
    pendingId = world.id;
    pendingKind = "start";
    pendingDeadline = Date.now() + 90_000;
    await fetch(`/api/worlds/${world.id}/activate`, { method: "POST" });
  });
}

function confirmStop(world) {
  confirmAction(`"${world.displayName}" stoppen? Niemand kann dann mehr auf den Server.`, async () => {
    pendingId = world.id;
    pendingKind = "stop";
    pendingDeadline = Date.now() + 60_000;
    await fetch(`/api/worlds/${world.id}/stop`, { method: "POST" });
  });
}

refresh();
pollTimer = setInterval(refresh, 2000);
