const worldsEl = document.getElementById("worlds");
const overlay = document.getElementById("confirm-overlay");
const confirmText = document.getElementById("confirm-text");
const confirmYes = document.getElementById("confirm-yes");
const confirmNo = document.getElementById("confirm-no");

const STATUS_LABELS = {
  running: "Läuft",
  stopped: "Gestoppt",
  starting: "Startet…",
  not_created: "Noch nie gestartet",
};

let pollTimer = null;
let switchTargetId = null;
let switchDeadline = null;

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
    if (world.status === "starting") {
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

    if (!world.missing && world.status !== "running" && world.status !== "starting") {
      tile.addEventListener("click", () => confirmSwitch(world));
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

    if (switchTargetId) {
      const target = worlds.find((w) => w.id === switchTargetId);
      if (target && target.status === "running") {
        switchTargetId = null;
      } else if (Date.now() > switchDeadline) {
        switchTargetId = null;
        worldsEl.insertAdjacentHTML(
          "afterbegin",
          '<p class="error">Wechsel dauert ungewöhnlich lange – bitte prüfen.</p>'
        );
      }
    }
  } catch (err) {
    worldsEl.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

function confirmSwitch(world) {
  confirmText.textContent = `Zu "${world.displayName}" wechseln? Der aktuell laufende Server wird gestoppt.`;
  overlay.classList.remove("hidden");

  const onYes = async () => {
    overlay.classList.add("hidden");
    cleanup();
    switchTargetId = world.id;
    switchDeadline = Date.now() + 90_000;
    await fetch(`/api/worlds/${world.id}/activate`, { method: "POST" });
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

refresh();
pollTimer = setInterval(refresh, 2000);
