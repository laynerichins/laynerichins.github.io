const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

function createMockCommon() {
  class QueryCommand {
    constructor(input) {
      this.input = input;
    }
  }

  class GetCommand {
    constructor(input) {
      this.input = input;
    }
  }

  class PutCommand {
    constructor(input) {
      this.input = input;
    }
  }

  class UpdateCommand {
    constructor(input) {
      this.input = input;
    }
  }

  class DeleteCommand {
    constructor(input) {
      this.input = input;
    }
  }

  class BatchWriteCommand {
    constructor(input) {
      this.input = input;
    }
  }

  const ddb = {
    send: async () => ({})
  };

  function json(statusCode, body) {
    return {
      statusCode,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type,x-admin-key",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
      },
      body: JSON.stringify(body)
    };
  }

  function parseBody(event) {
    if (!event.body) return {};
    if (typeof event.body === "object") return event.body;
    try {
      return JSON.parse(event.body);
    } catch {
      return {};
    }
  }

  function assertAdmin(event) {
    const key =
      event?.headers?.["x-admin-key"] ||
      event?.headers?.["X-Admin-Key"] ||
      event?.headers?.["x-admin-Key"];

    if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
      const err = new Error("Unauthorized");
      err.statusCode = 401;
      throw err;
    }
  }

  function hashAdminKey(key) {
    return createHash("sha256").update(String(key || "")).digest("hex");
  }

  async function broadcast() {
    return undefined;
  }

  function normalizeTicket(row, seasonHint) {
    const season = String(row.season || seasonHint || "").trim();
    const date = String(row.gameDate || row.date || "").trim();
    const id = String(row.ticketId || `${date}-${row.opponent || "TBD"}`).trim();

    return {
      ticketId: id,
      season,
      gameDate: date,
      gameTime: String(row.gameTime || row.time || "").trim(),
      opponent: String(row.opponent || "").trim(),
      section: String(row.section || "").trim(),
      row: String(row.row || "").trim(),
      seats: String(row.seats || "").trim(),
      notes: String(row.notes || "").trim(),
      status: row.status === "PICKED" ? "PICKED" : "AVAILABLE",
      pickedBy: String(row.pickedBy || "").trim(),
      pickedAt: String(row.pickedAt || "").trim()
    };
  }

  return {
    QueryCommand,
    GetCommand,
    PutCommand,
    UpdateCommand,
    DeleteCommand,
    BatchWriteCommand,
    ddb,
    json,
    parseBody,
    assertAdmin,
    hashAdminKey,
    broadcast,
    normalizeTicket,
    adminKeyItem: { season: "_SYSTEM", ticketId: "_ADMIN_KEY" },
    tables: {
      TICKETS_TABLE: process.env.TICKETS_TABLE || "TicketsTable",
      CONNECTIONS_TABLE: process.env.CONNECTIONS_TABLE || "ConnectionsTable"
    }
  };
}

function load(moduleRelPath, env = {}) {
  const commonPath = require.resolve("../src/common.js");
  const targetPath = require.resolve(moduleRelPath);

  delete require.cache[commonPath];
  delete require.cache[targetPath];

  process.env.TICKETS_TABLE = "TicketsTable";
  process.env.CONNECTIONS_TABLE = "ConnectionsTable";
  process.env.ADMIN_KEY = "test-admin-key";
  process.env.WEBSOCKET_ENDPOINT = env.websocketEndpoint || "";

  const common = createMockCommon();
  require.cache[commonPath] = {
    id: commonPath,
    filename: commonPath,
    loaded: true,
    exports: common
  };

  const mod = require(moduleRelPath);
  return { common, mod };
}

test("getTickets returns 400 without season", async () => {
  const { mod } = load("../src/getTickets.js");
  const res = await mod.handler({ queryStringParameters: {} });
  assert.equal(res.statusCode, 400);
});

test("getTickets returns items with season", async () => {
  const { common, mod } = load("../src/getTickets.js");
  common.ddb.send = async () => ({ Items: [{ season: "2026", ticketId: "abc" }] });

  const res = await mod.handler({ queryStringParameters: { season: "2026" } });
  assert.equal(res.statusCode, 200);

  const body = JSON.parse(res.body);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].ticketId, "abc");
});

test("pickTicket requires admin key", async () => {
  const { mod } = load("../src/pickTicket.js");
  const res = await mod.handler({ body: JSON.stringify({ season: "2026", ticketId: "abc" }) });
  assert.equal(res.statusCode, 401);
});

test("pickTicket updates selected record", async () => {
  const { common, mod } = load("../src/pickTicket.js");
  common.ddb.send = async () => ({
    Attributes: {
      season: "2026",
      ticketId: "abc",
      status: "PICKED",
      pickedBy: "Layne"
    }
  });

  const res = await mod.handler({
    headers: { "x-admin-key": "test-admin-key" },
    body: JSON.stringify({ season: "2026", ticketId: "abc", pickedBy: "Layne" })
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.item.ticketId, "abc");
  assert.equal(body.item.status, "PICKED");
});

test("importTickets accepts object body with items", async () => {
  const { common, mod } = load("../src/importTickets.js");
  let calls = 0;
  common.ddb.send = async () => {
    calls += 1;
    return {};
  };

  const res = await mod.handler({
    headers: { "x-admin-key": "test-admin-key" },
    body: JSON.stringify({
      season: "2026",
      items: [
        { gameDate: "2026-04-01", opponent: "Cubs" },
        { gameDate: "2026-04-02", opponent: "Dodgers" }
      ]
    })
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.imported, 2);
  assert.equal(calls >= 1, true);
});

test("importTickets accepts raw array body", async () => {
  const { common, mod } = load("../src/importTickets.js");
  let calls = 0;
  common.ddb.send = async () => {
    calls += 1;
    return {};
  };

  const res = await mod.handler({
    headers: { "x-admin-key": "test-admin-key" },
    body: JSON.stringify([
      { season: "2026", gameDate: "2026-05-01", opponent: "Giants" }
    ])
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.imported, 1);
  assert.equal(calls >= 1, true);
});

test("getTickets filters out draft config record", async () => {
  const { common, mod } = load("../src/getTickets.js");
  common.ddb.send = async () => ({
    Items: [
      { season: "2026", ticketId: "a", status: "AVAILABLE" },
      { season: "2026", ticketId: "_DRAFT_CONFIG", itemType: "DRAFT_CONFIG" }
    ]
  });

  const res = await mod.handler({ queryStringParameters: { season: "2026" } });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].ticketId, "a");
});

test("getDraftConfig returns null when missing", async () => {
  const { common, mod } = load("../src/getDraftConfig.js");
  common.ddb.send = async () => ({});

  const res = await mod.handler({ queryStringParameters: { season: "2026" } });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.config, null);
});

test("upsertDraftConfig requires admin key", async () => {
  const { mod } = load("../src/upsertDraftConfig.js");
  const res = await mod.handler({
    body: JSON.stringify({
      season: "2026",
      participants: [{ name: "Layne", tickets: 1 }],
      sequence: ["Layne"]
    })
  });

  assert.equal(res.statusCode, 401);
});

test("upsertDraftConfig stores config", async () => {
  const { common, mod } = load("../src/upsertDraftConfig.js");
  let calls = 0;
  common.ddb.send = async () => {
    calls += 1;
    return {};
  };

  const res = await mod.handler({
    headers: { "x-admin-key": "test-admin-key" },
    body: JSON.stringify({
      season: "2026",
      mode: "snake-quotas",
      seed: "seed",
      participants: [{ name: "Layne", tickets: 1 }],
      baseOrder: ["Layne"],
      sequence: ["Layne"]
    })
  });

  assert.equal(res.statusCode, 200);
  assert.equal(calls >= 1, true);
  const body = JSON.parse(res.body);
  assert.equal(body.saved, true);
  assert.equal(body.sequenceLength, 1);
});

test("rotateAdminKey requires admin key", async () => {
  const { mod } = load("../src/rotateAdminKey.js");
  const res = await mod.handler({
    body: JSON.stringify({ newAdminKey: "new-admin-key-123" })
  });

  assert.equal(res.statusCode, 401);
});

test("rotateAdminKey stores hashed key", async () => {
  const { common, mod } = load("../src/rotateAdminKey.js");
  let putInput;
  common.ddb.send = async (cmd) => {
    putInput = cmd.input;
    return {};
  };

  const res = await mod.handler({
    headers: { "x-admin-key": "test-admin-key" },
    body: JSON.stringify({ newAdminKey: "new-admin-key-123" })
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.rotated, true);
  assert.equal(Boolean(putInput?.Item?.adminKeyHash), true);
  assert.equal(putInput.Item.itemType, "ADMIN_KEY");
  assert.equal(putInput.Item.season, "_SYSTEM");
  assert.equal(putInput.Item.ticketId, "_ADMIN_KEY");
});
