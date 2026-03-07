const {
  BatchWriteCommand,
  ddb,
  json,
  parseBody,
  assertAdmin,
  broadcast,
  normalizeTicket,
  tables
} = require("./common");

exports.handler = async (event) => {
  try {
    await assertAdmin(event);
    const body = parseBody(event);

    const items = Array.isArray(body)
      ? body
      : Array.isArray(body.items)
        ? body.items
        : [];

    const season = String(
      (!Array.isArray(body) && body.season) ||
      event?.queryStringParameters?.season ||
      items[0]?.season ||
      ""
    ).trim();

    if (!season) return json(400, { message: "season is required." });
    if (items.length === 0) return json(400, { message: "items array is required." });

    const writes = items.map((raw) => ({
      PutRequest: {
        Item: normalizeTicket(raw, season)
      }
    }));

    for (let i = 0; i < writes.length; i += 25) {
      const chunk = writes.slice(i, i + 25);
      await ddb.send(
        new BatchWriteCommand({
          RequestItems: {
            [tables.TICKETS_TABLE]: chunk
          }
        })
      );
    }

    await broadcast({ type: "TICKETS_SYNC_REQUESTED", season });
    return json(200, { imported: items.length, season });
  } catch (err) {
    return json(err.statusCode || 500, { message: err.message || "Internal server error" });
  }
};
