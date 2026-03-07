#!/usr/bin/env node

import fs from "node:fs";

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

    if (ch === ',') {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if (ch === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    if (ch !== '\r') {
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

function pick(obj, keys) {
  for (const k of keys) {
    const key = normalizeHeader(k);
    if (obj[key] !== undefined && obj[key] !== "") return String(obj[key]).trim();
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
    const month = m[1].padStart(2, "0");
    const day = m[2].padStart(2, "0");
    const year = m[3];
    return `${year}-${month}-${day}`;
  }

  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return raw;
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

const [csvPath, seasonArg, defaultSection = "", defaultRow = "", defaultSeats = ""] = process.argv.slice(2);
if (!csvPath || !seasonArg) {
  console.error("Usage: node scripts/csv-to-json.mjs <csvPath> <season> [section] [row] [seats]");
  process.exit(1);
}

const csv = fs.readFileSync(csvPath, "utf8");
const rows = parseCsv(csv);
if (rows.length < 2) {
  console.error("CSV has no data rows.");
  process.exit(1);
}

const headers = rows[0].map((h) => normalizeHeader(h));
const seen = new Map();

const records = rows
  .slice(1)
  .filter((r) => r.some(Boolean))
  .map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] || "").trim();
    });

    const gameDate = toIsoDate(pick(obj, ["gameDate", "date", "startDate"]));
    const gameTime = pick(obj, ["gameTime", "time", "startTime"]);
    const subject = pick(obj, ["subject", "matchup", "event"]);
    const opponent = extractOpponent(subject, pick(obj, ["opponent", "awayTeam", "team"]));
    const section = pick(obj, ["section"]) || defaultSection;
    const row = pick(obj, ["row"]) || defaultRow;
    const seats = pick(obj, ["seats", "seat"]) || defaultSeats;
    const notes = pick(obj, ["notes"]) || pick(obj, ["location", "venue"]);

    const baseId = `${gameDate}-${slug(opponent)}`;
    const count = (seen.get(baseId) || 0) + 1;
    seen.set(baseId, count);

    const generatedId = count === 1 ? baseId : `${baseId}-${count}`;

    return {
      ticketId: pick(obj, ["ticketId", "ticketId", "ticketid"]) || generatedId,
      season: String(seasonArg),
      gameDate,
      gameTime,
      opponent,
      section,
      row,
      seats,
      notes,
      status: pick(obj, ["status"]).toUpperCase() === "PICKED" ? "PICKED" : "AVAILABLE",
      pickedBy: pick(obj, ["pickedBy", "pickedby", "picked by"]),
      pickedAt: pick(obj, ["pickedAt", "pickedat", "picked at"])
    };
  });

process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);