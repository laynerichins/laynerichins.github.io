const test = require("node:test");
const assert = require("node:assert/strict");

function load(moduleRelPath, env = {}) {
  const commonPath = require.resolve("../src/common.js");
  const targetPath = require.resolve(moduleRelPath);
  delete require.cache[commonPath];
  delete require.cache[targetPath];

  process.env.TICKETS_TABLE = "TicketsTable";
  process.env.CONNECTIONS_TABLE = "ConnectionsTable";
  process.env.ADMIN_KEY = "test-admin-key";
  process.env.WEBSOCKET_ENDPOINT = env.websocketEndpoint || "";

  const common = require("../src/common.js");
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