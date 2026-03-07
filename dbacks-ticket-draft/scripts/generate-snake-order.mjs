#!/usr/bin/env node

import fs from "node:fs";

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seedText) {
  let state = hashSeed(seedText) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffle(input, rand) {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalizeParticipants(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((p) => ({
      name: String(p.name || "").trim(),
      tickets: Number(p.tickets || p.count || 0)
    }))
    .filter((p) => p.name && p.tickets > 0);
}

function generateSnakeSequence(participants, baseOrder) {
  const remaining = Object.fromEntries(participants.map((p) => [p.name, p.tickets]));
  const total = participants.reduce((sum, p) => sum + p.tickets, 0);
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

function buildStats(sequence) {
  const stats = {};
  sequence.forEach((name, idx) => {
    const pick = idx + 1;
    if (!stats[name]) stats[name] = { picks: 0, firstPick: pick, lastPick: pick, averagePick: 0, total: 0 };
    stats[name].picks += 1;
    stats[name].firstPick = Math.min(stats[name].firstPick, pick);
    stats[name].lastPick = Math.max(stats[name].lastPick, pick);
    stats[name].total += pick;
  });

  Object.values(stats).forEach((s) => {
    s.averagePick = Number((s.total / s.picks).toFixed(2));
    delete s.total;
  });

  return stats;
}

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  if (i < 0 || i + 1 >= args.length) return "";
  return args[i + 1];
};

const participantsPath = getArg("--participants");
const outPath = getArg("--out");
const season = getArg("--season");
const seed = getArg("--seed") || `${Date.now()}`;

if (!participantsPath || !outPath || !season) {
  console.error("Usage: node scripts/generate-snake-order.mjs --participants <participants.json> --out <pick-order.json> --season <season> [--seed <seed>]");
  process.exit(1);
}

const participants = normalizeParticipants(readJson(participantsPath));
if (!participants.length) {
  console.error("No participants found.");
  process.exit(1);
}

const rand = makeRng(seed);
const baseOrder = shuffle(participants.map((p) => p.name), rand);
const sequence = generateSnakeSequence(participants, baseOrder);

const output = {
  season: String(season),
  mode: "snake-quotas",
  seed,
  participants,
  baseOrder,
  sequence,
  stats: buildStats(sequence)
};

writeJson(outPath, output);
console.log(JSON.stringify({ season, seed, picks: sequence.length, baseOrder }, null, 2));