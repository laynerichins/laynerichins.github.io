import { makeRng, parseParticipantsCsv, parseParticipantsText, parseScheduleCsv, participantsToText, shuffle } from "./seasonSetup.js";

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

function isVenueOnlyNote(value) {
  const note = String(value || "").trim();
  if (!note) return false;
  return /^chase\s+field(?:\s*[-,]\s*|\s+)phoenix$/i.test(note);
}

function normalizeName(value) {
  return String(value || "").trim();
}

function normalizeParticipants(list) {
  return (Array.isArray(list) ? list : [])
    .map((p) => {
      if (typeof p === "string") {
        return { name: normalizeName(p), tickets: 0 };
      }
      return {
        name: normalizeName(p.name),
        tickets: Number(p.tickets || p.count || 0)
      };
    })
    .filter((p) => p.name);
}

function tallyParticipantsFromSequence(sequence) {
  const map = new Map();
  sequence.forEach((name) => {
    const n = normalizeName(name);
    map.set(n, (map.get(n) || 0) + 1);
  });
  return [...map.entries()].map(([name, tickets]) => ({ name, tickets }));
}

function generateClassicSnakeSequence(participantsClean, baseOrder) {
  const remaining = Object.fromEntries(participantsClean.map((p) => [p.name, p.tickets]));
  const total = participantsClean.reduce((sum, p) => sum + p.tickets, 0);
  const sequence = [];

  let round = 0;
  while (sequence.length < total) {
    const order = round % 2 === 0 ? baseOrder : [...baseOrder].reverse();
    for (const name of order) {
      if (remaining[name] > 0) {
        sequence.push(name);
        remaining[name] -= 1;
      }
    }
    round += 1;
  }

  return sequence;
}

function generateEquitableSnakeSequence(participantsClean, baseOrder) {
  const total = participantsClean.reduce((sum, p) => sum + p.tickets, 0);
  const maxTickets = Math.max(...participantsClean.map((p) => p.tickets));
  const sequence = [];

  // Spread each participant's quota across rounds while preserving snake order each round.
  for (let round = 1; round <= maxTickets; round += 1) {
    const picksThisRound = new Set();

    participantsClean.forEach((p) => {
      const prev = Math.round(((round - 1) * p.tickets) / maxTickets);
      const curr = Math.round((round * p.tickets) / maxTickets);
      if (curr > prev) {
        picksThisRound.add(p.name);
      }
    });

    const order = round % 2 === 1 ? baseOrder : [...baseOrder].reverse();
    order.forEach((name) => {
      if (picksThisRound.has(name)) {
        sequence.push(name);
      }
    });
  }

  if (sequence.length !== total) {
    return generateClassicSnakeSequence(participantsClean, baseOrder);
  }

  const counts = new Map(tallyParticipantsFromSequence(sequence).map((p) => [p.name, p.tickets]));
  const validCounts = participantsClean.every((p) => counts.get(p.name) === p.tickets);
  if (!validCounts) {
    return generateClassicSnakeSequence(participantsClean, baseOrder);
  }

  return sequence;
}

function generateSnakeSequence(participants, baseOrderInput) {
  const participantsClean = normalizeParticipants(participants).filter((p) => p.tickets > 0);
  if (!participantsClean.length) return [];

  const nameSet = new Set(participantsClean.map((p) => p.name));

  let baseOrder = Array.isArray(baseOrderInput)
    ? baseOrderInput.map(normalizeName).filter((name) => nameSet.has(name))
    : [];

  const missing = participantsClean.map((p) => p.name).filter((name) => !baseOrder.includes(name));
  baseOrder = [...baseOrder, ...missing];

  return generateEquitableSnakeSequence(participantsClean, baseOrder);
}

function parseDraftConfigPayload(payload, ticketCountHint) {
  let participants = [];
  let sequence = [];
  let baseOrder = [];
  let mode = "";
  let seed = "";

  if (Array.isArray(payload)) {
    sequence = payload.map(normalizeName).filter(Boolean);
  } else if (payload && typeof payload === "object") {
    mode = normalizeName(payload.mode);
    seed = normalizeName(payload.seed);
    participants = normalizeParticipants(payload.participants);
    baseOrder = Array.isArray(payload.baseOrder) ? payload.baseOrder.map(normalizeName).filter(Boolean) : [];

    if (Array.isArray(payload.sequence) && payload.sequence.length) {
      sequence = payload.sequence.map(normalizeName).filter(Boolean);
    } else if (mode.startsWith("snake") && participants.length) {
      sequence = generateSnakeSequence(participants, baseOrder);
    } else if (Array.isArray(payload.order) && payload.order.length) {
      const repeating = payload.order.map(normalizeName).filter(Boolean);
      const total = ticketCountHint || repeating.length;
      sequence = Array.from({ length: total }, (_, i) => repeating[i % repeating.length]);
    }
  }

  if (!participants.length && sequence.length) {
    participants = tallyParticipantsFromSequence(sequence);
  }

  return {
    mode,
    seed,
    baseOrder,
    participants,
    sequence
  };
}

export function createDraftBoard({ adminMode }) {
  const config = { ...DEFAULT_CONFIG, ...(window.DRAFT_CONFIG || {}) };

  const state = {
    tickets: [],
    draft: {
      mode: "",
      seed: "",
      baseOrder: [],
      participants: [],
      sequence: []
    },
    setupPlan: null,
    socket: null,
    connected: false,
    adminKey: localStorage.getItem("dbacksAdminKey") || "",
    filters: {
      season: config.season || "2026",
      status: "ALL",
      month: "ALL",
      pickedBy: "ALL",
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
    pickedByFilter: document.getElementById("pickedByFilter"),
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
    draftParticipants: document.getElementById("draftParticipants"),
    fairnessSummary: document.getElementById("fairnessSummary"),
    draftOrderList: document.getElementById("draftOrderList"),
    adminKeyInput: document.getElementById("adminKeyInput"),
    saveAdminBtn: document.getElementById("saveAdminBtn"),
    adminState: document.getElementById("adminState"),
    newAdminKeyInput: document.getElementById("newAdminKeyInput"),
    rotateAdminKeyBtn: document.getElementById("rotateAdminKeyBtn"),
    rotateAdminState: document.getElementById("rotateAdminState"),
    setupSeasonInput: document.getElementById("setupSeasonInput"),
    setupSeedInput: document.getElementById("setupSeedInput"),
    setupScheduleFile: document.getElementById("setupScheduleFile"),
    setupParticipantsFile: document.getElementById("setupParticipantsFile"),
    setupParticipantsInput: document.getElementById("setupParticipantsInput"),
    previewSeasonBtn: document.getElementById("previewSeasonBtn"),
    createSeasonBtn: document.getElementById("createSeasonBtn"),
    setupStatus: document.getElementById("setupStatus"),
    setupPreview: document.getElementById("setupPreview"),
    draftOrderEditor: document.getElementById("draftOrderEditor"),
    loadDraftOrderBtn: document.getElementById("loadDraftOrderBtn"),
    rebalanceDraftOrderBtn: document.getElementById("rebalanceDraftOrderBtn"),
    saveDraftOrderBtn: document.getElementById("saveDraftOrderBtn"),
    pickedAssignmentsInput: document.getElementById("pickedAssignmentsInput"),
    loadPickedAssignmentsBtn: document.getElementById("loadPickedAssignmentsBtn"),
    applyPickedAssignmentsBtn: document.getElementById("applyPickedAssignmentsBtn"),
    draftEditStatus: document.getElementById("draftEditStatus")
  };

  function getPickedCount(items = state.tickets) {
    return items.filter((t) => t.status === "PICKED").length;
  }

  function currentOnClockName() {
    const idx = getPickedCount();
    return state.draft.sequence[idx] || "";
  }

  function upNextName() {
    const idx = getPickedCount() + 1;
    return state.draft.sequence[idx] || "";
  }

  function setStatus(mode, text) {
    if (!el.statusPill) return;
    el.statusPill.textContent = text;
    el.statusPill.classList.remove("ok", "warn", "error");
    el.statusPill.classList.add(mode);
  }

  function setSetupStatus(mode, text) {
    if (!el.setupStatus) return;
    el.setupStatus.textContent = text;
    el.setupStatus.classList.remove("status-ok", "status-warn", "status-error");
    if (mode) {
      el.setupStatus.classList.add(`status-${mode}`);
    }
  }

  function setRotateStatus(mode, text) {
    if (!el.rotateAdminState) return;
    el.rotateAdminState.textContent = text;
    el.rotateAdminState.classList.remove("status-ok", "status-warn", "status-error");
    if (mode) {
      el.rotateAdminState.classList.add(`status-${mode}`);
    }
  }

  function setDraftEditStatus(mode, text) {
    if (!el.draftEditStatus) return;
    el.draftEditStatus.textContent = text;
    el.draftEditStatus.classList.remove("status-ok", "status-warn", "status-error");
    if (mode) {
      el.draftEditStatus.classList.add(`status-${mode}`);
    }
  }

  function setSummary() {
    if (!el.summary) return;
    const all = state.tickets.length;
    const available = state.tickets.filter((t) => t.status === "AVAILABLE").length;
    const picked = all - available;

    el.summary.innerHTML = "";
    [`Total: ${all}`, `Available: ${available}`, `Picked: ${picked}`].forEach((text) => {
      const chip = document.createElement("span");
      chip.className = "metric";
      chip.textContent = text;
      el.summary.appendChild(chip);
    });
  }

  function setClockCard() {
    if (!el.onClock || !el.upNext || !el.picksMade) return;

    const picked = getPickedCount();
    el.picksMade.textContent = String(picked);

    if (!state.draft.sequence.length) {
      el.onClock.textContent = "Not configured";
      el.upNext.textContent = "Not configured";
      return;
    }

    el.onClock.textContent = currentOnClockName() || "Draft complete";
    el.upNext.textContent = upNextName() || "-";
  }

  function renderParticipants() {
    if (!el.draftParticipants) return;
    if (!state.draft.participants.length) {
      el.draftParticipants.innerHTML = '<div class="empty">No participant list loaded.</div>';
      return;
    }

    const rows = state.draft.participants
      .map((p) => `<span class="participant-chip">${escapeHtml(p.name)} (${p.tickets})</span>`)
      .join("");

    el.draftParticipants.innerHTML = rows;
  }

  function renderDraftOrder() {
    if (!el.draftOrderList) return;

    const picksDone = getPickedCount();
    const sequence = state.draft.sequence;

    if (!sequence.length) {
      el.draftOrderList.innerHTML = '<div class="empty">No draft order loaded.</div>';
      return;
    }

    const maxRows = 200;
    const rows = sequence.slice(0, maxRows).map((name, idx) => {
      const n = idx + 1;
      const cls = idx < picksDone ? "done" : idx === picksDone ? "current" : "pending";
      return `<div class="order-row ${cls}"><span class="num">#${n}</span><span class="name">${escapeHtml(name)}</span></div>`;
    }).join("");

    el.draftOrderList.innerHTML = rows;
  }

  function renderFairnessSummary() {
    if (!el.fairnessSummary) return;

    const sequence = state.draft.sequence || [];
    if (!sequence.length) {
      el.fairnessSummary.innerHTML = '<div class="empty">No draft order loaded.</div>';
      return;
    }

    const positionsByName = new Map();
    sequence.forEach((name, idx) => {
      const n = normalizeName(name);
      if (!n) return;
      if (!positionsByName.has(n)) positionsByName.set(n, []);
      positionsByName.get(n).push(idx + 1);
    });

    const participantNames = state.draft.participants.length
      ? state.draft.participants.map((p) => p.name).filter((name, idx, arr) => name && arr.indexOf(name) === idx)
      : [...positionsByName.keys()].sort();

    const total = sequence.length;
    const segment = Math.max(1, Math.ceil(total / 3));

    const rows = participantNames.map((name) => {
      const picks = positionsByName.get(name) || [];
      if (!picks.length) {
        return `
          <div class="fairness-row">
            <div class="fairness-name">${escapeHtml(name)}</div>
            <div class="fairness-stats">No picks in current order</div>
          </div>
        `;
      }

      const count = picks.length;
      const first = picks[0];
      const last = picks[picks.length - 1];
      const avg = picks.reduce((sum, n) => sum + n, 0) / count;
      const early = picks.filter((n) => n <= segment).length;
      const late = picks.filter((n) => n > total - segment).length;
      const middle = count - early - late;

      return `
        <div class="fairness-row">
          <div class="fairness-name">${escapeHtml(name)} <span class="fairness-count">(${count})</span></div>
          <div class="fairness-stats">First #${first} | Last #${last} | Avg #${avg.toFixed(1)}</div>
          <div class="fairness-split">Early/Mid/Late: ${early}/${middle}/${late}</div>
        </div>
      `;
    }).join('');

    el.fairnessSummary.innerHTML = `
      <div class="fairness-meta">Picks: ${total} | Third size: ${segment}</div>
      <div class="fairness-list">${rows}</div>
    `;
  }

  function updateAdminState() {
    if (!adminMode || !el.adminState) return;

    if (!state.adminKey) {
      el.adminState.textContent = "Admin locked. Enter key to enable pick actions.";
      return;
    }

    const onClock = currentOnClockName();
    if (onClock) {
      el.adminState.textContent = `Admin unlocked. Picks will be assigned to ${onClock}.`;
    } else {
      el.adminState.textContent = "Admin unlocked. Draft appears complete.";
    }
  }

  function hydrateFilters() {
    const teams = [...new Set(state.tickets.map((t) => t.opponent).filter(Boolean))].sort();
    const months = [...new Set(state.tickets.map((t) => monthKey(t.gameDate)).filter(Boolean))].sort();

    if (el.teamFilterWrap) {
      const activeTeams = new Set(state.filters.teams);
      el.teamFilterWrap.innerHTML = "";

      teams.forEach((team) => {
        const id = `team-${team.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        const row = document.createElement("label");
        row.className = "team-option";
        row.innerHTML = `<input type="checkbox" id="${id}" data-team="${escapeHtml(team)}" /> <span>${escapeHtml(team)}</span>`;
        const input = row.querySelector("input");
        input.checked = activeTeams.has(team);
        input.addEventListener("change", (event) => {
          const name = event.target.dataset.team;
          if (event.target.checked) {
            state.filters.teams.add(name);
          } else {
            state.filters.teams.delete(name);
          }
          renderBoard();
        });
        el.teamFilterWrap.appendChild(row);
      });
    }

    if (el.monthFilter) {
      const current = state.filters.month;
      el.monthFilter.innerHTML = "";
      el.monthFilter.appendChild(new Option("All months", "ALL"));
      months.forEach((m) => el.monthFilter.appendChild(new Option(prettyMonth(m), m)));
      state.filters.month = months.includes(current) ? current : "ALL";
      el.monthFilter.value = state.filters.month;
    }

    if (el.pickedByFilter) {
      const current = state.filters.pickedBy;
      const names = new Set();
      state.draft.participants.forEach((p) => names.add(p.name));
      state.tickets.forEach((t) => {
        if (t.pickedBy) names.add(t.pickedBy);
      });

      el.pickedByFilter.innerHTML = "";
      el.pickedByFilter.appendChild(new Option("All drafters", "ALL"));
      el.pickedByFilter.appendChild(new Option("Unpicked only", "UNPICKED"));
      [...names].sort().forEach((name) => el.pickedByFilter.appendChild(new Option(name, name)));

      const options = new Set(["ALL", "UNPICKED", ...names]);
      state.filters.pickedBy = options.has(current) ? current : "ALL";
      el.pickedByFilter.value = state.filters.pickedBy;
    }
  }

  function getFilteredTickets() {
    const { season, status, month, pickedBy, weekendOnly, teams } = state.filters;

    return state.tickets
      .filter((t) => !season || String(t.season) === String(season))
      .filter((t) => status === "ALL" || t.status === status)
      .filter((t) => month === "ALL" || monthKey(t.gameDate) === month)
      .filter((t) => {
        if (pickedBy === "ALL") return true;
        if (pickedBy === "UNPICKED") return t.status !== "PICKED";
        return t.pickedBy === pickedBy;
      })
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
      .slice(0, 60);

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
    const note = isVenueOnlyNote(ticket.notes) ? "" : String(ticket.notes || "");
    const statusClass = ticket.status === "PICKED" ? "status-picked" : "status-available";

    return `
      <article class="ticket-chip ${statusClass} ${compact ? "compact" : ""}">
        <div class="ticket-top">
          <h4>vs ${escapeHtml(ticket.opponent || "TBD")}</h4>
          <span class="badge ${badgeClass}">${escapeHtml(ticket.status)}</span>
        </div>
        <p class="ticket-time">${escapeHtml(ticket.gameTime || "")}</p>
        <p class="ticket-pick">${escapeHtml(pickedText)}</p>
        ${note ? `<p class="ticket-notes">${escapeHtml(note)}</p>` : ""}
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
      byDate.get(date).forEach((t) => lane.insertAdjacentHTML("beforeend", ticketMarkup(t, false)));

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
        games.forEach((t) => holder.insertAdjacentHTML("beforeend", ticketMarkup(t, true)));
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

    const view = state.filters.viewMode === "list" ? renderListView(tickets) : renderCalendarView(tickets);
    el.board.appendChild(view);
  }

  function renderSetupPreview(plan) {
    if (!el.setupPreview) return;

    if (!plan) {
      el.setupPreview.innerHTML = '<div class="empty">No preview generated yet.</div>';
      return;
    }

    const sequence = plan.draft.sequence;
    const shown = sequence.slice(0, 140);
    const rows = shown
      .map((name, idx) => `
        <div class="preview-row">
          <span class="num">#${idx + 1}</span>
          <span class="name">${escapeHtml(name)}</span>
        </div>
      `)
      .join("");

    const extra = sequence.length > shown.length
      ? `<div class="preview-meta">Showing first ${shown.length} of ${sequence.length} picks.</div>`
      : "";

    el.setupPreview.innerHTML = `
      <div class="preview-meta">Games: ${plan.tickets.length} | Picks: ${sequence.length} | Seed: ${escapeHtml(plan.draft.seed)}</div>
      <div class="preview-meta">Base order: ${escapeHtml(plan.draft.baseOrder.join(" -> "))}</div>
      ${extra}
      ${rows}
    `;
  }

  function applyDraftDefaultsToSetup() {
    if (!adminMode) return;

    if (el.setupSeasonInput && !el.setupSeasonInput.value.trim()) {
      el.setupSeasonInput.value = String(state.filters.season || "");
    }

    if (el.setupParticipantsInput && !el.setupParticipantsInput.value.trim() && state.draft.participants.length) {
      el.setupParticipantsInput.value = participantsToText(state.draft.participants);
    }
  }

  function refreshAll() {
    setSummary();
    setClockCard();
    updateAdminState();
    renderParticipants();
    renderDraftOrder();
    renderFairnessSummary();
    renderPickedLog();
    renderBoard();
    applyDraftDefaultsToSetup();
  }

  async function adminAction(action, ticketId) {
    if (!state.adminKey) {
      throw new Error("Enter and save the admin key first.");
    }

    const season = String(state.filters.season || config.season || "").trim();
    const picksDone = getPickedCount();
    const autoPickedBy = state.draft.sequence[picksDone] || "";

    if (action === "pick" && !autoPickedBy) {
      throw new Error("Draft order is complete or not configured.");
    }

    if (!config.apiBaseUrl) {
      const idx = state.tickets.findIndex((t) => t.ticketId === ticketId);
      if (idx < 0) return;
      state.tickets[idx] = {
        ...state.tickets[idx],
        status: action === "pick" ? "PICKED" : "AVAILABLE",
        pickedBy: action === "pick" ? autoPickedBy : "",
        pickedAt: action === "pick" ? new Date().toISOString() : ""
      };
      refreshAll();
      return;
    }

    const endpoint = `${config.apiBaseUrl}/admin/${action}`;
    const body = action === "pick"
      ? { season, ticketId, pickedBy: autoPickedBy }
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

    const payload = safeParseJson(await res.text(), {});
    if (payload?.item) {
      applyTicketUpdate(payload.item);
      return;
    }

    // Fallback if API response omits item: apply local optimistic update.
    const idx = state.tickets.findIndex((t) => t.ticketId === ticketId);
    if (idx >= 0) {
      state.tickets[idx] = {
        ...state.tickets[idx],
        status: action === "pick" ? "PICKED" : "AVAILABLE",
        pickedBy: action === "pick" ? autoPickedBy : "",
        pickedAt: action === "pick" ? new Date().toISOString() : ""
      };
      hydrateFilters();
      refreshAll();
    }
  }

  function applyTicketUpdate(ticket) {
    const idx = state.tickets.findIndex((t) => t.ticketId === ticket.ticketId);
    if (idx >= 0) {
      state.tickets[idx] = ticket;
    } else {
      state.tickets.push(ticket);
    }

    hydrateFilters();
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
        hydrateFilters();
        refreshAll();
      }
      if (payload.type === "DRAFT_CONFIG_UPDATED" && payload.config) {
        const season = String(payload.config.season || "").trim();
        if (!season || season === String(state.filters.season)) {
          state.draft = parseDraftConfigPayload(payload.config, state.tickets.length);
          hydrateFilters();
          refreshAll();
        }
      }
      if (payload.type === "TICKETS_SYNC_REQUESTED") {
        loadTickets().catch(() => {});
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

  async function loadDraftConfigFromApi(season) {
    if (!config.apiBaseUrl) return null;

    try {
      const res = await fetch(`${config.apiBaseUrl}/draft-config?season=${encodeURIComponent(season)}`);
      if (!res.ok) return null;
      const payload = await res.json();
      if (!payload || !payload.config) return null;
      return parseDraftConfigPayload(payload.config, state.tickets.length);
    } catch {
      return null;
    }
  }

  async function loadPickOrderFromFile(season) {
    const source = config.pickOrderUrl || `../data/pick-order-${season}.json`;

    try {
      const res = await fetch(source, { cache: "no-store" });
      if (!res.ok) return null;
      const payload = await res.json();
      return parseDraftConfigPayload(payload, state.tickets.length);
    } catch {
      return null;
    }
  }

  async function loadDraftConfig() {
    const season = String(state.filters.season || config.season || "").trim();
    if (!season) return;

    const apiDraft = await loadDraftConfigFromApi(season);
    if (apiDraft && (apiDraft.sequence.length || apiDraft.participants.length)) {
      state.draft = apiDraft;
      return;
    }

    const fileDraft = await loadPickOrderFromFile(season);
    if (fileDraft && (fileDraft.sequence.length || fileDraft.participants.length)) {
      state.draft = fileDraft;
      return;
    }

    state.draft = { mode: "", seed: "", baseOrder: [], participants: [], sequence: [] };
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
      await loadDraftConfig();
      hydrateFilters();
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
    await loadDraftConfig();
    hydrateFilters();
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

    if (el.pickedByFilter) {
      el.pickedByFilter.addEventListener("change", () => {
        state.filters.pickedBy = el.pickedByFilter.value;
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
      el.refreshBtn.addEventListener("click", () => {
        loadTickets().catch((err) => console.error(err));
      });
    }
  }

  function readInputFileText(inputEl) {
    const file = inputEl?.files?.[0];
    if (!file) return Promise.resolve("");
    return file.text();
  }

  function buildSeasonPlan(targetSeason, scheduleCsvText, participantsText, seedInput) {
    const season = String(targetSeason || "").trim();
    if (!season) {
      throw new Error("Season is required.");
    }

    const tickets = parseScheduleCsv(scheduleCsvText, season);
    if (!tickets.length) {
      throw new Error("No valid games found in schedule CSV.");
    }

    const participants = normalizeParticipants(parseParticipantsText(participantsText)).filter((p) => p.tickets > 0);
    if (!participants.length) {
      throw new Error("No valid participants found.");
    }

    const totalGames = tickets.length;
    const totalPicks = participants.reduce((sum, p) => sum + p.tickets, 0);
    if (totalGames !== totalPicks) {
      throw new Error(`Participant ticket total (${totalPicks}) must equal schedule games (${totalGames}).`);
    }

    const seed = String(seedInput || `${season}-dbacks-${Date.now()}`).trim();
    const baseOrder = shuffle(participants.map((p) => p.name), makeRng(seed));
    const sequence = generateSnakeSequence(participants, baseOrder);

    return {
      season,
      tickets,
      draft: {
        mode: "snake-equitable-quotas",
        seed,
        participants,
        baseOrder,
        sequence
      }
    };
  }

  async function previewSeasonSetup() {
    const seasonValue = String(el.setupSeasonInput?.value || state.filters.season || "").trim();
    const scheduleCsvText = await readInputFileText(el.setupScheduleFile);
    if (!scheduleCsvText) {
      throw new Error("Select a schedule CSV file.");
    }

    let participantsText = String(el.setupParticipantsInput?.value || "").trim();

    if (!participantsText) {
      const participantsCsvText = await readInputFileText(el.setupParticipantsFile);
      if (participantsCsvText) {
        const participantsFromCsv = parseParticipantsCsv(participantsCsvText);
        participantsText = participantsToText(participantsFromCsv);
        if (el.setupParticipantsInput) {
          el.setupParticipantsInput.value = participantsText;
        }
      }
    }

    if (!participantsText) {
      throw new Error("Enter participants and ticket counts.");
    }

    const seed = String(el.setupSeedInput?.value || "").trim();
    const plan = buildSeasonPlan(seasonValue, scheduleCsvText, participantsText, seed);
    state.setupPlan = plan;
    renderSetupPreview(plan);
    setSetupStatus("ok", `Preview ready for ${plan.season}: ${plan.tickets.length} games and ${plan.draft.sequence.length} picks.`);
    return plan;
  }

  async function postAdminJson(path, body) {
    if (!config.apiBaseUrl) {
      throw new Error("API is not configured.");
    }
    if (!state.adminKey) {
      throw new Error("Save your admin key first.");
    }

    const res = await fetch(`${config.apiBaseUrl}${path}`, {
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
      throw new Error(payload.message || `Request failed (${res.status}).`);
    }

    return safeParseJson(await res.text(), {});
  }

  async function createSeasonFromSetup() {
    setSetupStatus("warn", "Creating season...");

    let plan = state.setupPlan;
    const requestedSeason = String(el.setupSeasonInput?.value || "").trim();
    if (!plan || (requestedSeason && requestedSeason !== plan.season)) {
      plan = await previewSeasonSetup();
    }

    await postAdminJson("/admin/import", {
      season: plan.season,
      items: plan.tickets
    });

    await postAdminJson("/admin/draft-config", {
      season: plan.season,
      mode: plan.draft.mode,
      seed: plan.draft.seed,
      participants: plan.draft.participants,
      baseOrder: plan.draft.baseOrder,
      sequence: plan.draft.sequence
    });

    state.filters.season = plan.season;
    if (el.seasonInput) {
      el.seasonInput.value = plan.season;
    }

    await loadTickets();
    setSetupStatus("ok", `Season ${plan.season} created. Imported ${plan.tickets.length} games and draft order.`);
  }

  function parseSequenceInput(text) {
    return String(text || "")
      .split(/\r?\n/g)
      .map(normalizeName)
      .filter(Boolean);
  }

  function parsePickedAssignmentsInput(text) {
    const assignments = new Map();
    const lines = String(text || "").split(/\r?\n/g);

    lines.forEach((raw, idx) => {
      const line = raw.trim();
      if (!line || line.startsWith("#")) return;

      const commaAt = line.indexOf(",");
      if (commaAt < 0) {
        throw new Error(`Line ${idx + 1}: use ticketId,pickedBy format.`);
      }

      const ticketId = line.slice(0, commaAt).trim();
      const pickedBy = line.slice(commaAt + 1).trim();
      if (!ticketId || !pickedBy) {
        throw new Error(`Line ${idx + 1}: ticketId and pickedBy are both required.`);
      }
      if (assignments.has(ticketId)) {
        throw new Error(`Line ${idx + 1}: duplicate ticketId '${ticketId}'.`);
      }
      assignments.set(ticketId, pickedBy);
    });

    return assignments;
  }

  function loadDraftOrderEditorFromState() {
    if (!el.draftOrderEditor) return;
    el.draftOrderEditor.value = state.draft.sequence.join("\n");
  }

  function loadPickedAssignmentsEditorFromState() {
    if (!el.pickedAssignmentsInput) return;
    const lines = state.tickets
      .filter((t) => t.status === "PICKED")
      .sort((a, b) => a.gameDate.localeCompare(b.gameDate))
      .map((t) => String(t.ticketId) + "," + String(t.pickedBy || ""));
    el.pickedAssignmentsInput.value = lines.join("\n");
  }

  function getDraftParticipantsForRegeneration() {
    const fromDraft = normalizeParticipants(state.draft.participants).filter((p) => p.tickets > 0);
    if (fromDraft.length) return fromDraft;

    const fromSequence = normalizeParticipants(tallyParticipantsFromSequence(state.draft.sequence)).filter((p) => p.tickets > 0);
    return fromSequence;
  }

  function generateSnakeDraftOrderFromCurrentState() {
    const participants = getDraftParticipantsForRegeneration();
    if (!participants.length) {
      throw new Error("No participant quotas are loaded for this season.");
    }

    const totalTickets = participants.reduce((sum, p) => sum + p.tickets, 0);
    if (state.tickets.length && totalTickets !== state.tickets.length) {
      throw new Error("Participant ticket total (" + totalTickets + ") must match game count (" + state.tickets.length + ").");
    }

    const participantNames = participants.map((p) => p.name);
    const existingBase = (Array.isArray(state.draft.baseOrder) ? state.draft.baseOrder : [])
      .map(normalizeName)
      .filter((name) => participantNames.includes(name));

    const missing = participantNames.filter((name) => !existingBase.includes(name));
    let baseOrder = [...existingBase, ...missing];

    if (!baseOrder.length) {
      const seed = String(state.draft.seed || (String(state.filters.season || "draft") + "-equitable-snake")).trim();
      baseOrder = shuffle(participantNames, makeRng(seed));
    }

    return generateSnakeSequence(participants, baseOrder);
  }

  function buildBaseOrderFromSequence(sequence) {
    const seen = new Set();
    const base = [];
    sequence.forEach((name) => {
      if (seen.has(name)) return;
      seen.add(name);
      base.push(name);
    });
    return base;
  }

  async function saveDraftOrderFromEditor() {
    const sequence = parseSequenceInput(el.draftOrderEditor?.value || "");
    if (!sequence.length) {
      throw new Error("Draft order cannot be empty.");
    }
    if (sequence.length !== state.tickets.length) {
      throw new Error(`Draft order lines (${sequence.length}) must match game count (${state.tickets.length}).`);
    }

    const season = String(state.filters.season || config.season || "").trim();
    if (!season) {
      throw new Error("Season is required.");
    }

    const participants = tallyParticipantsFromSequence(sequence);
    const baseOrder = buildBaseOrderFromSequence(sequence);
    const payload = {
      season,
      mode: state.draft.mode || "manual-sequence",
      seed: state.draft.seed || "",
      participants,
      baseOrder,
      sequence
    };

    if (!config.apiBaseUrl) {
      state.draft = parseDraftConfigPayload(payload, state.tickets.length);
      hydrateFilters();
      refreshAll();
      return;
    }

    await postAdminJson("/admin/draft-config", payload);
    await loadDraftConfig();
    hydrateFilters();
    refreshAll();
  }

  async function applyPickedAssignmentsFromEditor() {
    const assignments = parsePickedAssignmentsInput(el.pickedAssignmentsInput?.value || "");
    const ticketsById = new Map(state.tickets.map((t) => [t.ticketId, t]));
    const unknownIds = [...assignments.keys()].filter((id) => !ticketsById.has(id));
    if (unknownIds.length) {
      throw new Error(`Unknown ticketId(s): ${unknownIds.slice(0, 8).join(", ")}`);
    }

    const updates = state.tickets
      .map((ticket) => {
        const wantedPickedBy = assignments.get(ticket.ticketId) || "";
        const wantedStatus = wantedPickedBy ? "PICKED" : "AVAILABLE";
        const sameStatus = ticket.status === wantedStatus;
        const samePicker = wantedStatus !== "PICKED" || ticket.pickedBy === wantedPickedBy;
        if (sameStatus && samePicker) return null;
        return {
          ticketId: ticket.ticketId,
          wantedStatus,
          wantedPickedBy
        };
      })
      .filter(Boolean);

    if (!updates.length) {
      return 0;
    }

    if (!config.apiBaseUrl) {
      const now = new Date().toISOString();
      const updatesById = new Map(updates.map((u) => [u.ticketId, u]));
      state.tickets = state.tickets.map((ticket) => {
        const update = updatesById.get(ticket.ticketId);
        if (!update) return ticket;

        if (update.wantedStatus === "PICKED") {
          return {
            ...ticket,
            status: "PICKED",
            pickedBy: update.wantedPickedBy,
            pickedAt: now
          };
        }

        return {
          ...ticket,
          status: "AVAILABLE",
          pickedBy: "",
          pickedAt: ""
        };
      });

      hydrateFilters();
      refreshAll();
      return updates.length;
    }

    const season = String(state.filters.season || config.season || "").trim();
    for (const update of updates) {
      if (update.wantedStatus === "PICKED") {
        await postAdminJson("/admin/pick", {
          season,
          ticketId: update.ticketId,
          pickedBy: update.wantedPickedBy
        });
      } else {
        await postAdminJson("/admin/unpick", {
          season,
          ticketId: update.ticketId
        });
      }
    }

    await loadTickets();
    return updates.length;
  }

  async function rotateAdminKeyFromUi() {
    const newKey = String(el.newAdminKeyInput?.value || "").trim();
    if (!newKey || newKey.length < 8) {
      throw new Error("New admin key must be at least 8 characters.");
    }

    await postAdminJson("/admin/rotate-key", { newAdminKey: newKey });

    state.adminKey = newKey;
    localStorage.setItem("dbacksAdminKey", newKey);
    if (el.adminKeyInput) {
      el.adminKeyInput.value = newKey;
    }
    if (el.newAdminKeyInput) {
      el.newAdminKeyInput.value = "";
    }

    updateAdminState();
    setRotateStatus("ok", "Admin key rotated and saved in this browser session.");
  }

  async function verifyAdminKey(key) {
    const candidate = String(key || "").trim();
    if (!candidate) return false;

    if (!config.apiBaseUrl) {
      return true;
    }

    try {
      const res = await fetch(`${config.apiBaseUrl}/admin/pick`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [config.adminHeaderName || "x-admin-key"]: candidate
        },
        body: JSON.stringify({})
      });

      return res.status !== 401;
    } catch {
      throw new Error("Could not verify admin key (API/network error).");
    }
  }

  function wireAdmin() {
    if (!adminMode) return;

    if (el.adminKeyInput) {
      el.adminKeyInput.value = state.adminKey;
    }

    if (el.saveAdminBtn) {
      el.saveAdminBtn.addEventListener("click", async () => {
        const candidate = (el.adminKeyInput?.value || "").trim();

        if (!candidate) {
          state.adminKey = "";
          localStorage.removeItem("dbacksAdminKey");
          updateAdminState();
          setRotateStatus("warn", "Use current admin key to rotate to a new one.");
          renderBoard();
          return;
        }

        try {
          const valid = await verifyAdminKey(candidate);
          if (!valid) {
            state.adminKey = "";
            localStorage.removeItem("dbacksAdminKey");
            if (el.adminState) {
              el.adminState.textContent = "Admin key invalid. Access remains locked.";
            }
            setRotateStatus("error", "Current admin key is invalid.");
            renderBoard();
            return;
          }

          state.adminKey = candidate;
          localStorage.setItem("dbacksAdminKey", state.adminKey);
          updateAdminState();
          setRotateStatus("warn", "Use current admin key to rotate to a new one.");
          renderBoard();
        } catch (err) {
          state.adminKey = "";
          localStorage.removeItem("dbacksAdminKey");
          if (el.adminState) {
            el.adminState.textContent = err.message || "Could not verify admin key.";
          }
          setRotateStatus("error", err.message || "Could not verify admin key.");
          renderBoard();
        }
      });
    }

    if (el.rotateAdminKeyBtn) {
      el.rotateAdminKeyBtn.addEventListener("click", async () => {
        try {
          await rotateAdminKeyFromUi();
        } catch (err) {
          setRotateStatus("error", err.message || "Failed to rotate admin key.");
        }
      });
    }

    if (el.setupSeasonInput) {
      el.setupSeasonInput.value = state.filters.season;
    }

    if (el.setupParticipantsFile) {
      el.setupParticipantsFile.addEventListener("change", async () => {
        try {
          const text = await readInputFileText(el.setupParticipantsFile);
          if (!text) return;
          const participants = parseParticipantsCsv(text);
          if (!participants.length) {
            throw new Error("Participants CSV has no valid rows.");
          }
          if (el.setupParticipantsInput) {
            el.setupParticipantsInput.value = participantsToText(participants);
          }
          setSetupStatus("ok", `Loaded ${participants.length} participants from CSV.`);
        } catch (err) {
          setSetupStatus("error", err.message || "Failed to parse participants CSV.");
        }
      });
    }

    if (el.previewSeasonBtn) {
      el.previewSeasonBtn.addEventListener("click", async () => {
        try {
          await previewSeasonSetup();
        } catch (err) {
          state.setupPlan = null;
          renderSetupPreview(null);
          setSetupStatus("error", err.message || "Preview failed.");
        }
      });
    }

    if (el.createSeasonBtn) {
      el.createSeasonBtn.addEventListener("click", async () => {
        try {
          await createSeasonFromSetup();
        } catch (err) {
          setSetupStatus("error", err.message || "Failed to create season.");
        }
      });
    }

    if (el.loadDraftOrderBtn) {
      el.loadDraftOrderBtn.addEventListener("click", () => {
        loadDraftOrderEditorFromState();
        setDraftEditStatus("ok", "Loaded current draft sequence into the editor.");
      });
    }

    if (el.rebalanceDraftOrderBtn) {
      el.rebalanceDraftOrderBtn.addEventListener("click", () => {
        try {
          const sequence = generateSnakeDraftOrderFromCurrentState();
          if (el.draftOrderEditor) {
            el.draftOrderEditor.value = sequence.join("\n");
          }
          setDraftEditStatus("ok", "Generated equitable snake order in editor. Review, then click Save Draft Order.");
        } catch (err) {
          setDraftEditStatus("error", err.message || "Failed to generate equitable snake order.");
        }
      });
    }

    if (el.saveDraftOrderBtn) {
      el.saveDraftOrderBtn.addEventListener("click", async () => {
        try {
          setDraftEditStatus("warn", "Saving draft order...");
          await saveDraftOrderFromEditor();
          setDraftEditStatus("ok", "Draft order saved.");
        } catch (err) {
          setDraftEditStatus("error", err.message || "Failed to save draft order.");
        }
      });
    }

    if (el.loadPickedAssignmentsBtn) {
      el.loadPickedAssignmentsBtn.addEventListener("click", () => {
        loadPickedAssignmentsEditorFromState();
        setDraftEditStatus("ok", "Loaded current picked assignments.");
      });
    }

    if (el.applyPickedAssignmentsBtn) {
      el.applyPickedAssignmentsBtn.addEventListener("click", async () => {
        try {
          setDraftEditStatus("warn", "Applying picked assignments...");
          const changed = await applyPickedAssignmentsFromEditor();
          setDraftEditStatus("ok", changed
            ? `Applied ${changed} pick update${changed === 1 ? "" : "s"}.`
            : "No changes to apply.");
        } catch (err) {
          setDraftEditStatus("error", err.message || "Failed to apply pick assignments.");
        }
      });
    }

    updateAdminState();
    setRotateStatus("warn", "Use current admin key to rotate to a new one.");
    renderSetupPreview(null);
    loadDraftOrderEditorFromState();
    loadPickedAssignmentsEditorFromState();
    setDraftEditStatus("warn", "Load current values before editing if someone else may have made recent changes.");
  }

  async function init() {
    wireFilters();
    wireAdmin();

    try {
      await loadTickets();
      if (adminMode) {
        loadDraftOrderEditorFromState();
        loadPickedAssignmentsEditorFromState();
      }
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





















