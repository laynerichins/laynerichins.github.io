const FALLBACK_TICKETS = [
  {
    ticketId: "2026-04-03-fallback",
    season: "2026",
    gameDate: "2026-04-03",
    gameTime: "6:40 PM",
    opponent: "Cubs",
    notes: "Demo data",
    status: "AVAILABLE",
    pickedBy: "",
    pickedAt: ""
  }
];

const DEFAULT_CONFIG = {
  apiBaseUrl: "",
  wsUrl: "",
  season: "2026",
  adminHeaderName: "x-admin-key",
  pickOrderUrl: ""
};

const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const DOW_FMT = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const DATE_FMT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", weekday: "short" });

function toDate(dateText) {
  return new Date(`${dateText}T00:00:00`);
}

function monthKey(dateText) {
  return dateText.slice(0, 7);
}

function prettyMonth(month) {
  const [year, mo] = month.split("-");
  return MONTH_FMT.format(new Date(Number(year), Number(mo) - 1, 1));
}

function safeParseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createDraftBoard({ adminMode }) {
  const config = { ...DEFAULT_CONFIG, ...(window.DRAFT_CONFIG || {}) };

  const state = {
    tickets: [],
    order: [],
    socket: null,
    connected: false,
    adminKey: localStorage.getItem("dbacksAdminKey") || "",
    pickedBy: localStorage.getItem("dbacksPickedBy") || "",
    filters: {
      season: config.season || "2026",
      status: "ALL",
      month: "ALL",
      weekendOnly: false,
      teams: new Set(),
      viewMode: "calendar"
    }
  };

  const el = {
    statusPill: document.getElementById("connectionStatus"),
    seasonInput: document.getElementById("seasonInput"),
    statusFilter: document.getElementById("statusFilter"),
    monthFilter: document.getElementById("monthFilter"),
    weekendOnly: document.getElementById("weekendOnly"),
    teamFilterWrap: document.getElementById("teamFilterWrap"),
    viewCalendarBtn: document.getElementById("viewCalendarBtn"),
    viewListBtn: document.getElementById("viewListBtn"),
    summary: document.getElementById("summary"),
    board: document.getElementById("board"),
    pickedLog: document.getElementById("pickedLog"),
    refreshBtn: document.getElementById("refreshBtn"),
    onClock: document.getElementById("onClock"),
    upNext: document.getElementById("upNext"),
    picksMade: document.getElementById("picksMade"),
    adminKeyInput: document.getElementById("adminKeyInput"),
    pickedByInput: document.getElementById("pickedByInput"),
    saveAdminBtn: document.getElementById("saveAdminBtn"),
    adminState: document.getElementById("adminState")
  };

  function setStatus(mode, text) {
    if (!el.statusPill) return;
    el.statusPill.textContent = text;
    el.statusPill.classList.remove("ok", "warn", "error");
    el.statusPill.classList.add(mode);
  }

  function getPickedCount(items) {
    return items.filter((t) => t.status === "PICKED").length;
  }

  function setClockCard() {
    if (!el.onClock || !el.upNext || !el.picksMade) return;

    const picked = getPickedCount(state.tickets);
    el.picksMade.textContent = String(picked);

    if (!state.order.length) {
      el.onClock.textContent = "Not configured";
      el.upNext.textContent = "Not configured";
      return;
    }

    const idx = picked % state.order.length;
    const next = (picked + 1) % state.order.length;
    el.onClock.textContent = state.order[idx];
    el.upNext.textContent = state.order[next];
  }

  function setSummary() {
    if (!el.summary) return;
    const all = state.tickets.length;
    const available = state.tickets.filter((t) => t.status === "AVAILABLE").length;
    const picked = all - available;

    el.summary.innerHTML = "";
    [
      `Total: ${all}`,
      `Available: ${available}`,
      `Picked: ${picked}`
    ].forEach((text) => {
      const chip = document.createElement("span");
      chip.className = "metric";
      chip.textContent = text;
      el.summary.appendChild(chip);
    });
  }

  function updateAdminState() {
    if (!adminMode || !el.adminState) return;
    el.adminState.textContent = state.adminKey
      ? "Admin unlocked. Pick actions are enabled."
      : "Admin locked. Enter key to enable pick actions.";
  }

  function hydrateFilters() {
    const teams = [...new Set(state.tickets.map((t) => t.opponent).filter(Boolean))].sort();
    const months = [...new Set(state.tickets.map((t) => monthKey(t.gameDate)).filter(Boolean))].sort();

    if (el.teamFilterWrap) {
      el.teamFilterWrap.innerHTML = "";
      teams.forEach((team) => {
        const id = `team-${team.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        const row = document.createElement("label");
        row.className = "team-option";
        row.innerHTML = `<input type="checkbox" id="${id}" data-team="${escapeHtml(team)}" /> <span>${escapeHtml(team)}</span>`;
        const input = row.querySelector("input");
        input.addEventListener("change", (event) => {
          const t = event.target.dataset.team;
          if (event.target.checked) {
            state.filters.teams.add(t);
          } else {
            state.filters.teams.delete(t);
          }
          renderBoard();
        });
        el.teamFilterWrap.appendChild(row);
      });
    }

    if (el.monthFilter) {
      const current = el.monthFilter.value || "ALL";
      el.monthFilter.innerHTML = "";
      const allOpt = document.createElement("option");
      allOpt.value = "ALL";
      allOpt.textContent = "All months";
      el.monthFilter.appendChild(allOpt);

      months.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = prettyMonth(m);
        el.monthFilter.appendChild(opt);
      });

      el.monthFilter.value = months.includes(current) ? current : "ALL";
      state.filters.month = el.monthFilter.value;
    }
  }

  function getFilteredTickets() {
    const { season, status, month, weekendOnly, teams } = state.filters;

    return state.tickets
      .filter((t) => !season || String(t.season) === String(season))
      .filter((t) => status === "ALL" || t.status === status)
      .filter((t) => month === "ALL" || monthKey(t.gameDate) === month)
      .filter((t) => {
        if (!weekendOnly) return true;
        const day = toDate(t.gameDate).getDay();
        return day === 0 || day === 6;
      })
      .filter((t) => teams.size === 0 || teams.has(t.opponent))
      .sort((a, b) => a.gameDate.localeCompare(b.gameDate));
  }

  function renderPickedLog() {
    if (!el.pickedLog) return;
    const picked = state.tickets
      .filter((t) => t.status === "PICKED")
      .sort((a, b) => new Date(b.pickedAt || 0) - new Date(a.pickedAt || 0))
      .slice(0, 50);

    el.pickedLog.innerHTML = "";
    if (!picked.length) {
      el.pickedLog.innerHTML = '<div class="empty">No picks yet.</div>';
      return;
    }

    picked.forEach((t) => {
      const line = document.createElement("div");
      line.className = "log-item";
      const when = t.pickedAt ? new Date(t.pickedAt).toLocaleString() : "time unknown";
      line.textContent = `${DATE_FMT.format(toDate(t.gameDate))} vs ${t.opponent} picked by ${t.pickedBy || "Unknown"} (${when})`;
      el.pickedLog.appendChild(line);
    });
  }

  function actionButton(ticket) {
    if (!adminMode || !state.adminKey) return "";

    const action = ticket.status === "AVAILABLE" ? "pick" : "unpick";
    const label = action === "pick" ? "Mark Picked" : "Re-open";
    const klass = action === "pick" ? "pick-btn" : "unpick-btn";
    return `<button class="${klass}" data-action="${action}" data-ticket-id="${escapeHtml(ticket.ticketId)}">${label}</button>`;
  }

  function ticketMarkup(ticket, compact) {
    const badgeClass = ticket.status === "PICKED" ? "picked" : "available";
    const pickedText = ticket.status === "PICKED"
      ? `Picked by ${ticket.pickedBy || "Unknown"}`
      : "Available";

    return `
      <article class="ticket-chip ${compact ? "compact" : ""}">
        <div class="ticket-top">
          <h4>vs ${escapeHtml(ticket.opponent || "TBD")}</h4>
          <span class="badge ${badgeClass}">${escapeHtml(ticket.status)}</span>
        </div>
        <p class="ticket-time">${escapeHtml(ticket.gameTime || "")}</p>
        <p class="ticket-pick">${escapeHtml(pickedText)}</p>
        ${ticket.notes ? `<p class="ticket-notes">${escapeHtml(ticket.notes)}</p>` : ""}
        ${actionButton(ticket)}
      </article>
    `;
  }

  function renderListView(tickets) {
    const byDate = new Map();
    tickets.forEach((t) => {
      if (!byDate.has(t.gameDate)) byDate.set(t.gameDate, []);
      byDate.get(t.gameDate).push(t);
    });

    const wrapper = document.createElement("div");
    wrapper.className = "list-view";

    [...byDate.keys()].sort().forEach((date) => {
      const row = document.createElement("section");
      row.className = "list-day";
      row.innerHTML = `<h3>${DATE_FMT.format(toDate(date))}</h3>`;

      const lane = document.createElement("div");
      lane.className = "list-day-games";
      byDate.get(date).forEach((t) => {
        lane.insertAdjacentHTML("beforeend", ticketMarkup(t, false));
      });

      row.appendChild(lane);
      wrapper.appendChild(row);
    });

    return wrapper;
  }

  function monthCalendarGrid(month, monthTickets) {
    const [year, monthNum] = month.split("-").map(Number);
    const daysInMonth = new Date(year, monthNum, 0).getDate();
    const firstDow = new Date(year, monthNum - 1, 1).getDay();

    const byDate = new Map();
    monthTickets.forEach((t) => {
      if (!byDate.has(t.gameDate)) byDate.set(t.gameDate, []);
      byDate.get(t.gameDate).push(t);
    });

    const section = document.createElement("section");
    section.className = "calendar-month";

    const title = document.createElement("h3");
    title.className = "month-title";
    title.textContent = prettyMonth(month);
    section.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "calendar-grid";

    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((d) => {
      const h = document.createElement("div");
      h.className = "dow";
      h.textContent = d;
      grid.appendChild(h);
    });

    for (let i = 0; i < firstDow; i += 1) {
      const empty = document.createElement("div");
      empty.className = "day-cell empty";
      grid.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const cell = document.createElement("div");
      cell.className = "day-cell";
      const dow = DOW_FMT.format(toDate(date));
      cell.innerHTML = `<div class="day-head"><span class="day-num">${day}</span><span class="day-dow">${dow}</span></div>`;

      const games = byDate.get(date) || [];
      if (!games.length) {
        cell.insertAdjacentHTML("beforeend", '<div class="no-game">-</div>');
      } else {
        const holder = document.createElement("div");
        holder.className = "day-games";
        games.forEach((t) => {
          holder.insertAdjacentHTML("beforeend", ticketMarkup(t, true));
        });
        cell.appendChild(holder);
      }

      grid.appendChild(cell);
    }

    section.appendChild(grid);
    return section;
  }

  function renderCalendarView(tickets) {
    const byMonth = new Map();
    tickets.forEach((t) => {
      const mk = monthKey(t.gameDate);
      if (!byMonth.has(mk)) byMonth.set(mk, []);
      byMonth.get(mk).push(t);
    });

    const wrap = document.createElement("div");
    wrap.className = "calendar-view";
    [...byMonth.keys()].sort().forEach((m) => {
      wrap.appendChild(monthCalendarGrid(m, byMonth.get(m)));
    });

    return wrap;
  }

  function renderBoard() {
    if (!el.board) return;
    const tickets = getFilteredTickets();
    el.board.innerHTML = "";

    if (!tickets.length) {
      el.board.innerHTML = '<div class="empty">No games match these filters.</div>';
      return;
    }

    const view = state.filters.viewMode === "list"
      ? renderListView(tickets)
      : renderCalendarView(tickets);

    el.board.appendChild(view);

    if (adminMode) {
      el.board.querySelectorAll("button[data-action]").forEach((btn) => {
        btn.addEventListener("click", () => adminAction(btn.dataset.action, btn.dataset.ticketId));
      });
    }
  }

  function refreshAll() {
    setSummary();
    setClockCard();
    renderPickedLog();
    renderBoard();
  }

  async function adminAction(action, ticketId) {
    if (!state.adminKey) {
      alert("Enter and save the admin key first.");
      return;
    }

    const pickedBy = (el.pickedByInput?.value || state.pickedBy || "Admin").trim();
    state.pickedBy = pickedBy;
    localStorage.setItem("dbacksPickedBy", pickedBy);

    const season = String(state.filters.season || config.season || "").trim();

    if (!config.apiBaseUrl) {
      const idx = state.tickets.findIndex((t) => t.ticketId === ticketId);
      if (idx < 0) return;
      const now = new Date().toISOString();
      state.tickets[idx] = {
        ...state.tickets[idx],
        status: action === "pick" ? "PICKED" : "AVAILABLE",
        pickedBy: action === "pick" ? pickedBy : "",
        pickedAt: action === "pick" ? now : ""
      };
      refreshAll();
      return;
    }

    const endpoint = `${config.apiBaseUrl}/admin/${action}`;
    const body = action === "pick"
      ? { season, ticketId, pickedBy }
      : { season, ticketId };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [config.adminHeaderName || "x-admin-key"]: state.adminKey
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const payload = safeParseJson(await res.text(), {});
      if (res.status === 401) {
        throw new Error("Unauthorized. Your admin key is incorrect or outdated.");
      }
      throw new Error(payload.message || `Admin action failed (${res.status})`);
    }

    await loadTickets();
  }

  function applyTicketUpdate(ticket) {
    const idx = state.tickets.findIndex((t) => t.ticketId === ticket.ticketId);
    if (idx >= 0) {
      state.tickets[idx] = ticket;
    } else {
      state.tickets.push(ticket);
    }
    refreshAll();
  }

  function connectSocket() {
    if (!config.wsUrl) {
      setStatus("warn", config.apiBaseUrl ? "Polling mode" : "Local data mode");
      return;
    }

    const ws = new WebSocket(config.wsUrl);
    state.socket = ws;

    ws.addEventListener("open", () => {
      state.connected = true;
      setStatus("ok", "Live updates on");
    });

    ws.addEventListener("message", (event) => {
      const payload = safeParseJson(event.data || "{}", {});
      if (payload.type === "TICKET_UPDATED" && payload.ticket) {
        applyTicketUpdate(payload.ticket);
      }
      if (payload.type === "TICKETS_SYNC" && Array.isArray(payload.tickets)) {
        state.tickets = payload.tickets;
        refreshAll();
      }
    });

    ws.addEventListener("close", () => {
      state.connected = false;
      setStatus("warn", "Reconnecting...");
      setTimeout(connectSocket, 2000);
    });

    ws.addEventListener("error", () => {
      setStatus("error", "Socket error");
    });
  }

  async function loadPickOrder() {
    const season = String(state.filters.season || config.season || "").trim();
    if (!season) return;

    const defaultUrl = `../data/pick-order-${season}.json`;
    const src = config.pickOrderUrl || defaultUrl;

    try {
      const res = await fetch(src, { cache: "no-store" });
      if (!res.ok) {
        state.order = [];
        setClockCard();
        return;
      }
      const payload = await res.json();
      if (Array.isArray(payload)) {
        state.order = payload.map((x) => String(x).trim()).filter(Boolean);
      } else if (Array.isArray(payload.order)) {
        state.order = payload.order.map((x) => String(x).trim()).filter(Boolean);
      } else {
        state.order = [];
      }
      setClockCard();
    } catch {
      state.order = [];
      setClockCard();
    }
  }

  async function loadLocalTickets(season) {
    const file = `../data/${season}-tickets.json`;
    const res = await fetch(file, { cache: "no-store" });
    if (!res.ok) throw new Error("local data missing");
    const items = await res.json();
    return Array.isArray(items) ? items : [];
  }

  async function loadTickets() {
    const season = String(state.filters.season || config.season || "").trim();

    if (!config.apiBaseUrl) {
      try {
        state.tickets = await loadLocalTickets(season);
        setStatus("warn", "Local data mode");
      } catch {
        state.tickets = [...FALLBACK_TICKETS];
        setStatus("warn", "Demo data mode");
      }
      hydrateFilters();
      await loadPickOrder();
      refreshAll();
      return;
    }

    const res = await fetch(`${config.apiBaseUrl}/tickets?season=${encodeURIComponent(season)}`);
    if (!res.ok) {
      setStatus("error", "API error");
      throw new Error(`Failed to load tickets (${res.status})`);
    }

    const payload = await res.json();
    state.tickets = Array.isArray(payload.items) ? payload.items : [];
    hydrateFilters();
    await loadPickOrder();
    refreshAll();
  }

  function wireFilters() {
    if (el.seasonInput) {
      el.seasonInput.value = state.filters.season;
      el.seasonInput.addEventListener("change", async () => {
        state.filters.season = el.seasonInput.value.trim();
        await loadTickets();
      });
    }

    if (el.statusFilter) {
      el.statusFilter.addEventListener("change", () => {
        state.filters.status = el.statusFilter.value;
        renderBoard();
      });
    }

    if (el.monthFilter) {
      el.monthFilter.addEventListener("change", () => {
        state.filters.month = el.monthFilter.value;
        renderBoard();
      });
    }

    if (el.weekendOnly) {
      el.weekendOnly.addEventListener("change", () => {
        state.filters.weekendOnly = el.weekendOnly.checked;
        renderBoard();
      });
    }

    if (el.viewCalendarBtn && el.viewListBtn) {
      const setActive = () => {
        el.viewCalendarBtn.classList.toggle("active", state.filters.viewMode === "calendar");
        el.viewListBtn.classList.toggle("active", state.filters.viewMode === "list");
      };
      el.viewCalendarBtn.addEventListener("click", () => {
        state.filters.viewMode = "calendar";
        setActive();
        renderBoard();
      });
      el.viewListBtn.addEventListener("click", () => {
        state.filters.viewMode = "list";
        setActive();
        renderBoard();
      });
      setActive();
    }

    if (el.refreshBtn) {
      el.refreshBtn.addEventListener("click", loadTickets);
    }
  }

  function wireAdmin() {
    if (!adminMode) return;

    if (el.adminKeyInput) el.adminKeyInput.value = state.adminKey;
    if (el.pickedByInput) el.pickedByInput.value = state.pickedBy;

    if (el.saveAdminBtn) {
      el.saveAdminBtn.addEventListener("click", () => {
        state.adminKey = (el.adminKeyInput?.value || "").trim();
        state.pickedBy = (el.pickedByInput?.value || "").trim();

        if (state.adminKey) {
          localStorage.setItem("dbacksAdminKey", state.adminKey);
        } else {
          localStorage.removeItem("dbacksAdminKey");
        }

        localStorage.setItem("dbacksPickedBy", state.pickedBy || "Admin");
        updateAdminState();
        renderBoard();
      });
    }

    updateAdminState();
  }

  async function init() {
    wireFilters();
    wireAdmin();

    try {
      await loadTickets();
    } catch (err) {
      console.error(err);
    }

    connectSocket();
    setInterval(() => {
      loadTickets().catch(() => {});
    }, 30000);

    if (adminMode) {
      document.body.addEventListener("click", async (event) => {
        const btn = event.target.closest("button[data-action][data-ticket-id]");
        if (!btn) return;
        try {
          await adminAction(btn.dataset.action, btn.dataset.ticketId);
        } catch (err) {
          alert(err.message || "Action failed.");
        }
      });
    }
  }

  return { init };
}