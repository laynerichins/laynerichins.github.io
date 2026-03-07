const FALLBACK_TICKETS = [
  {
    ticketId: "2026-04-03-A",
    season: "2026",
    gameDate: "2026-04-03",
    gameTime: "6:40 PM",
    opponent: "Cubs",
    section: "112",
    row: "18",
    seats: "2",
    notes: "Opening weekend",
    status: "AVAILABLE",
    pickedBy: "",
    pickedAt: ""
  },
  {
    ticketId: "2026-04-10-A",
    season: "2026",
    gameDate: "2026-04-10",
    gameTime: "6:40 PM",
    opponent: "Dodgers",
    section: "112",
    row: "18",
    seats: "2",
    notes: "Rivalry game",
    status: "PICKED",
    pickedBy: "Tanner",
    pickedAt: "2026-03-06T20:15:00Z"
  }
];

const config = window.DRAFT_CONFIG || {
  apiBaseUrl: "",
  wsUrl: "",
  season: "2026",
  adminHeaderName: "x-admin-key"
};

const state = {
  tickets: [],
  adminKey: localStorage.getItem("dbacksAdminKey") || "",
  pickedBy: localStorage.getItem("dbacksPickedBy") || "",
  connected: false,
  socket: null
};

const el = {
  status: document.getElementById("connectionStatus"),
  seasonInput: document.getElementById("seasonInput"),
  filter: document.getElementById("statusFilter"),
  board: document.getElementById("board"),
  summary: document.getElementById("summary"),
  pickedLog: document.getElementById("pickedLog"),
  adminKeyInput: document.getElementById("adminKeyInput"),
  pickedByInput: document.getElementById("pickedByInput"),
  adminState: document.getElementById("adminState"),
  saveAdminBtn: document.getElementById("saveAdminBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  ticketCardTemplate: document.getElementById("ticketCardTemplate")
};

function fmtDate(dateInput) {
  if (!dateInput) return "Unknown date";
  const d = new Date(dateInput + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function fmtDateTime(dateInput, timeInput) {
  return `${fmtDate(dateInput)} ${timeInput || ""}`.trim();
}

function setConnectionStatus(mode, text) {
  el.status.textContent = text;
  if (mode === "connected") {
    el.status.style.background = "#dcfce7";
    el.status.style.color = "#166534";
  } else if (mode === "error") {
    el.status.style.background = "#fee2e2";
    el.status.style.color = "#991b1b";
  } else {
    el.status.style.background = "#eef2ff";
    el.status.style.color = "#3730a3";
  }
}

function updateAdminState() {
  if (state.adminKey) {
    el.adminState.textContent = "Admin mode is unlocked.";
  } else {
    el.adminState.textContent = "Admin mode is locked.";
  }
}

function setSummary() {
  const all = state.tickets.length;
  const available = state.tickets.filter((t) => t.status === "AVAILABLE").length;
  const picked = state.tickets.filter((t) => t.status === "PICKED").length;
  el.summary.innerHTML = "";

  const metrics = [`Total: ${all}`, `Available: ${available}`, `Picked: ${picked}`];

  metrics.forEach((text) => {
    const span = document.createElement("span");
    span.className = "metric";
    span.textContent = text;
    el.summary.appendChild(span);
  });
}

function getFilteredTickets() {
  const season = (el.seasonInput.value || config.season || "").trim();
  const filter = el.filter.value;

  return state.tickets
    .filter((t) => !season || String(t.season) === season)
    .filter((t) => filter === "ALL" || t.status === filter)
    .sort((a, b) => String(a.gameDate).localeCompare(String(b.gameDate)));
}

function renderPickedLog() {
  const picked = state.tickets
    .filter((t) => t.status === "PICKED")
    .sort((a, b) => new Date(b.pickedAt || 0) - new Date(a.pickedAt || 0))
    .slice(0, 40);

  el.pickedLog.innerHTML = "";
  if (picked.length === 0) {
    el.pickedLog.textContent = "No picks yet.";
    return;
  }

  picked.forEach((t) => {
    const row = document.createElement("div");
    row.className = "log-item";
    const at = t.pickedAt ? new Date(t.pickedAt).toLocaleString() : "Unknown time";
    row.textContent = `${fmtDate(t.gameDate)} vs ${t.opponent} picked by ${t.pickedBy || "Unknown"} at ${at}`;
    el.pickedLog.appendChild(row);
  });
}

function refreshView() {
  setSummary();
  renderBoard();
  renderPickedLog();
}

function applyLocalAction(action, ticketId, pickedBy) {
  const idx = state.tickets.findIndex((t) => t.ticketId === ticketId);
  if (idx < 0) {
    alert("Ticket not found.");
    return;
  }

  const now = new Date().toISOString();
  if (action === "pick") {
    state.tickets[idx] = {
      ...state.tickets[idx],
      status: "PICKED",
      pickedBy,
      pickedAt: now
    };
  } else {
    state.tickets[idx] = {
      ...state.tickets[idx],
      status: "AVAILABLE",
      pickedBy: "",
      pickedAt: ""
    };
  }

  refreshView();
}

async function adminAction(action, ticketId) {
  if (!state.adminKey) {
    alert("Enter and save admin key first.");
    return;
  }

  const pickedBy = (el.pickedByInput.value || state.pickedBy || "Admin").trim();
  state.pickedBy = pickedBy;
  localStorage.setItem("dbacksPickedBy", pickedBy);

  if (!config.apiBaseUrl) {
    applyLocalAction(action, ticketId, pickedBy);
    return;
  }

  const endpoint = `${config.apiBaseUrl}/admin/${action}`;
  const body = {
    ticketId,
    season: (el.seasonInput.value || config.season || "").trim()
  };
  if (action === "pick") {
    body.pickedBy = pickedBy;
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [config.adminHeaderName || "x-admin-key"]: state.adminKey
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const message = await res.text();
      throw new Error(message || `Failed admin action (${res.status})`);
    }

    await loadTickets();
  } catch (err) {
    alert(`Action failed: ${err.message}`);
  }
}

function renderBoard() {
  const tickets = getFilteredTickets();
  el.board.innerHTML = "";

  if (tickets.length === 0) {
    el.board.textContent = "No tickets found for this filter/season.";
    return;
  }

  tickets.forEach((ticket) => {
    const card = el.ticketCardTemplate.content.firstElementChild.cloneNode(true);

    card.querySelector(".date").textContent = fmtDateTime(ticket.gameDate, ticket.gameTime);
    card.querySelector(".opponent").textContent = `vs ${ticket.opponent || "TBD"}`;
    card.querySelector(".meta").textContent = `Section ${ticket.section || "-"}, Row ${ticket.row || "-"}, Seats ${ticket.seats || "-"}`;
    card.querySelector(".notes").textContent = ticket.notes || "";

    const pickedText = ticket.status === "PICKED"
      ? `Picked by ${ticket.pickedBy || "Unknown"}${ticket.pickedAt ? ` on ${new Date(ticket.pickedAt).toLocaleString()}` : ""}`
      : "Available";
    card.querySelector(".picked").textContent = pickedText;

    const badge = card.querySelector(".badge");
    badge.textContent = ticket.status;
    badge.classList.add(ticket.status === "PICKED" ? "picked" : "available");

    const actions = card.querySelector(".actions");
    if (state.adminKey) {
      const btn = document.createElement("button");
      if (ticket.status === "AVAILABLE") {
        btn.className = "pick";
        btn.textContent = "Mark Picked";
        btn.addEventListener("click", () => adminAction("pick", ticket.ticketId));
      } else {
        btn.className = "unpick";
        btn.textContent = "Re-open";
        btn.addEventListener("click", () => adminAction("unpick", ticket.ticketId));
      }
      actions.appendChild(btn);
    }

    el.board.appendChild(card);
  });
}

function applyTicketUpdate(updatedTicket) {
  const idx = state.tickets.findIndex((t) => t.ticketId === updatedTicket.ticketId);
  if (idx >= 0) {
    state.tickets[idx] = updatedTicket;
  } else {
    state.tickets.push(updatedTicket);
  }

  refreshView();
}

function connectSocket() {
  if (!config.wsUrl) {
    setConnectionStatus("idle", config.apiBaseUrl ? "Polling mode" : "Local data mode");
    return;
  }

  try {
    const ws = new WebSocket(config.wsUrl);
    state.socket = ws;

    ws.addEventListener("open", () => {
      state.connected = true;
      setConnectionStatus("connected", "Live updates on");
    });

    ws.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data || "{}");
        if (payload.type === "TICKET_UPDATED" && payload.ticket) {
          applyTicketUpdate(payload.ticket);
          return;
        }
        if (payload.type === "TICKETS_SYNC" && Array.isArray(payload.tickets)) {
          state.tickets = payload.tickets;
          refreshView();
        }
      } catch (_err) {
        // Ignore malformed messages.
      }
    });

    ws.addEventListener("close", () => {
      state.connected = false;
      setConnectionStatus("idle", "Reconnecting...");
      setTimeout(connectSocket, 2000);
    });

    ws.addEventListener("error", () => {
      setConnectionStatus("error", "Socket error");
    });
  } catch (_err) {
    setConnectionStatus("error", "Live updates unavailable");
  }
}

async function loadLocalSeasonTickets(season) {
  const dataPath = `../data/${season}-tickets.json`;
  const res = await fetch(dataPath, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Local data file not found (${dataPath})`);
  }
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

async function loadTickets() {
  const season = (el.seasonInput.value || config.season || "").trim();
  const url = `${config.apiBaseUrl}/tickets?season=${encodeURIComponent(season)}`;

  if (!config.apiBaseUrl) {
    try {
      const items = await loadLocalSeasonTickets(season);
      state.tickets = items;
      setConnectionStatus("idle", "Local data mode");
    } catch (_err) {
      state.tickets = [...FALLBACK_TICKETS];
      setConnectionStatus("idle", "Demo data mode");
    }
    refreshView();
    return;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load tickets (${res.status})`);
    const payload = await res.json();
    state.tickets = Array.isArray(payload.items) ? payload.items : [];
    refreshView();
  } catch (err) {
    setConnectionStatus("error", "API error");
    console.error(err);
  }
}

function wireEvents() {
  el.seasonInput.value = config.season || "2026";
  el.adminKeyInput.value = state.adminKey;
  el.pickedByInput.value = state.pickedBy;

  el.saveAdminBtn.addEventListener("click", () => {
    state.adminKey = (el.adminKeyInput.value || "").trim();
    state.pickedBy = (el.pickedByInput.value || "").trim();
    if (state.adminKey) {
      localStorage.setItem("dbacksAdminKey", state.adminKey);
    } else {
      localStorage.removeItem("dbacksAdminKey");
    }
    localStorage.setItem("dbacksPickedBy", state.pickedBy || "Admin");
    updateAdminState();
    renderBoard();
  });

  el.filter.addEventListener("change", renderBoard);
  el.seasonInput.addEventListener("change", loadTickets);
  el.refreshBtn.addEventListener("click", loadTickets);
}

async function init() {
  wireEvents();
  updateAdminState();
  await loadTickets();
  connectSocket();

  // Poll as a fallback in case socket is blocked in some environments.
  setInterval(loadTickets, 30000);
}

init();