function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if (ch === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    if (ch !== "\r") {
      cell += ch;
    }
  }

  if (cell.length || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }

  return rows;
}

function normalizeHeader(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function pickCell(obj, keys) {
  for (const k of keys) {
    const key = normalizeHeader(k);
    if (obj[key] !== undefined && obj[key] !== "") {
      return String(obj[key]).trim();
    }
  }
  return "";
}

function toIsoDate(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }

  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return "";
}

function slug(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "tbd";
}

function extractOpponent(subject, fallback) {
  const s = String(subject || "").trim();
  if (!s) return String(fallback || "").trim();

  let m = s.match(/^(.+?)\s+at\s+D-backs$/i);
  if (m) return m[1].trim();

  m = s.match(/^D-backs\s+vs\.?\s+(.+)$/i);
  if (m) return m[1].trim();

  return String(fallback || s).trim();
}

export function parseScheduleCsv(csvText, season) {
  const rows = parseCsv(csvText).filter((r) => r.some((c) => String(c || "").trim() !== ""));
  if (rows.length < 2) {
    throw new Error("Schedule CSV has no data rows.");
  }

  const headers = rows[0].map((h) => normalizeHeader(h));
  const seen = new Map();
  const items = [];

  rows.slice(1).forEach((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = String(r[idx] || "").trim();
    });

    const gameDate = toIsoDate(pickCell(obj, ["gameDate", "date", "startDate"]));
    const gameTime = pickCell(obj, ["gameTime", "time", "startTime"]);
    const subject = pickCell(obj, ["subject", "matchup", "event"]);
    const opponent = extractOpponent(subject, pickCell(obj, ["opponent", "awayTeam", "team"]));

    if (!gameDate || !opponent) {
      return;
    }

    const notes = pickCell(obj, ["notes", "location", "venue"]);
    const baseId = `${gameDate}-${slug(opponent)}`;
    const count = (seen.get(baseId) || 0) + 1;
    seen.set(baseId, count);

    items.push({
      ticketId: count === 1 ? baseId : `${baseId}-${count}`,
      season,
      gameDate,
      gameTime,
      opponent,
      section: "",
      row: "",
      seats: "",
      notes,
      status: "AVAILABLE",
      pickedBy: "",
      pickedAt: ""
    });
  });

  return items.sort((a, b) => a.gameDate.localeCompare(b.gameDate));
}

function normalizeParticipants(list) {
  return (Array.isArray(list) ? list : [])
    .map((p) => ({ name: String(p.name || "").trim(), tickets: Number(p.tickets || 0) }))
    .filter((p) => p.name && p.tickets > 0);
}
export function parseParticipantsText(raw) {
  const rows = String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const merged = new Map();

  rows.forEach((line) => {
    if (/^name\s*,\s*(count|tickets)/i.test(line)) {
      return;
    }

    let name = "";
    let countText = "";

    if (line.includes(",")) {
      const parts = line.split(",");
      name = String(parts[0] || "").trim();
      countText = String(parts[1] || "").trim();
    } else if (line.includes("\t")) {
      const parts = line.split("\t");
      name = String(parts[0] || "").trim();
      countText = String(parts[1] || "").trim();
    } else {
      const m = line.match(/^(.*?)[\s:-]+(\d+)$/);
      if (m) {
        name = m[1].trim();
        countText = m[2].trim();
      }
    }

    const tickets = Number(countText);
    if (!name || !Number.isFinite(tickets) || tickets <= 0) {
      throw new Error(`Invalid participant entry: ${line}`);
    }

    merged.set(name, (merged.get(name) || 0) + Math.trunc(tickets));
  });

  return [...merged.entries()].map(([name, tickets]) => ({ name, tickets }));
}

export function parseParticipantsCsv(csvText) {
  const rows = parseCsv(csvText).filter((r) => r.some((c) => String(c || "").trim() !== ""));
  if (!rows.length) {
    return [];
  }

  const firstRow = rows[0].map((c) => normalizeHeader(c));
  const hasHeader = firstRow.includes("name") || firstRow.includes("participant") || firstRow.includes("numberoftickets");
  const dataRows = hasHeader ? rows.slice(1) : rows;

  if (hasHeader) {
    const headers = rows[0].map((h) => normalizeHeader(h));
    const text = dataRows
      .map((r) => {
        const obj = {};
        headers.forEach((h, idx) => {
          obj[h] = String(r[idx] || "").trim();
        });
        const name = pickCell(obj, ["name", "participant"]);
        const tickets = pickCell(obj, ["tickets", "count", "numberoftickets"]);
        return name && tickets ? `${name},${tickets}` : "";
      })
      .filter(Boolean)
      .join("\n");

    return parseParticipantsText(text);
  }

  const text = dataRows
    .map((r) => `${String(r[0] || "").trim()},${String(r[1] || "").trim()}`)
    .join("\n");

  return parseParticipantsText(text);
}

export function participantsToText(participants) {
  const normalized = normalizeParticipants(participants);
  return normalized.map((p) => `${p.name},${p.tickets}`).join("\n");
}

function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seedText) {
  let state = hashSeed(seedText || "seed") || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function shuffle(input, rand) {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
