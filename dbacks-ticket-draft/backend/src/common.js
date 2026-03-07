const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  QueryCommand,
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

function assertAdmin(event) {
  const key =
    event?.headers?.["x-admin-key"] ||
    event?.headers?.["X-Admin-Key"] ||
    event?.headers?.["x-admin-Key"];

  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    const err = new Error("Unauthorized");
    err.statusCode = 401;
    throw err;
  }
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
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  BatchWriteCommand,
  ddb,
  json,
  parseBody,
  assertAdmin,
  broadcast,
  normalizeTicket,
  tables: {
    TICKETS_TABLE,
    CONNECTIONS_TABLE
  }
};

