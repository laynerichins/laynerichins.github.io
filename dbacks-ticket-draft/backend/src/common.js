const { createHash } = require("node:crypto");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
  BatchWriteCommand
} = require("@aws-sdk/lib-dynamodb");
const {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand
} = require("@aws-sdk/client-apigatewaymanagementapi");

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const TICKETS_TABLE = process.env.TICKETS_TABLE;
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE;
const ADMIN_KEY = process.env.ADMIN_KEY;
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT;

const ADMIN_KEY_ITEM = {
  season: "_SYSTEM",
  ticketId: "_ADMIN_KEY"
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
  } catch (_err) {
    return {};
  }
}

function unauthorizedError() {
  const err = new Error("Unauthorized");
  err.statusCode = 401;
  return err;
}

function readAdminHeader(event) {
  return String(
    event?.headers?.["x-admin-key"] ||
    event?.headers?.["X-Admin-Key"] ||
    event?.headers?.["x-admin-Key"] ||
    ""
  ).trim();
}

function hashAdminKey(key) {
  return createHash("sha256").update(String(key || "")).digest("hex");
}

async function getStoredAdminKeyHash() {
  try {
    const out = await ddb.send(
      new GetCommand({
        TableName: TICKETS_TABLE,
        Key: ADMIN_KEY_ITEM
      })
    );

    return String(out?.Item?.adminKeyHash || "").trim();
  } catch {
    return "";
  }
}

async function assertAdmin(event) {
  const key = readAdminHeader(event);
  if (!key) {
    throw unauthorizedError();
  }

  if (ADMIN_KEY && key === ADMIN_KEY) {
    return;
  }

  const storedHash = await getStoredAdminKeyHash();
  if (storedHash && hashAdminKey(key) === storedHash) {
    return;
  }

  throw unauthorizedError();
}

async function listConnections() {
  const out = await ddb.send(new ScanCommand({ TableName: CONNECTIONS_TABLE }));
  return out.Items || [];
}

async function broadcast(payload) {
  if (!WEBSOCKET_ENDPOINT) return;
  const api = new ApiGatewayManagementApiClient({ endpoint: WEBSOCKET_ENDPOINT });
  const message = JSON.stringify(payload);
  const clients = await listConnections();

  await Promise.all(
    clients.map(async (c) => {
      try {
        await api.send(new PostToConnectionCommand({ ConnectionId: c.connectionId, Data: message }));
      } catch (err) {
        if (err.statusCode === 410) {
          await ddb.send(
            new DeleteCommand({
              TableName: CONNECTIONS_TABLE,
              Key: { connectionId: c.connectionId }
            })
          );
          return;
        }
        throw err;
      }
    })
  );
}

function normalizeTicket(row, seasonHint) {
  const season = String(row.season || seasonHint || "").trim();
  const date = String(row.gameDate || row.date || "").trim();
  const id = String(row.ticketId || `${date}-${row.opponent || "TBD"}-${row.section || ""}-${row.row || ""}`).trim();

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

module.exports = {
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
  adminKeyItem: ADMIN_KEY_ITEM,
  tables: {
    TICKETS_TABLE,
    CONNECTIONS_TABLE
  }
};
