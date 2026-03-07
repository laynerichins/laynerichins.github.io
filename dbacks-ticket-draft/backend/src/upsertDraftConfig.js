const {
  PutCommand,
  ddb,
  json,
  parseBody,
  assertAdmin,
  broadcast,
  tables
} = require("./common");

exports.handler = async (event) => {
  try {
    await assertAdmin(event);
    const body = parseBody(event);

    const season = String(body.season || event?.queryStringParameters?.season || "").trim();
    if (!season) return json(400, { message: "season is required." });

    const participants = Array.isArray(body.participants) ? body.participants : [];
    const baseOrder = Array.isArray(body.baseOrder) ? body.baseOrder : [];
    const sequence = Array.isArray(body.sequence) ? body.sequence : [];

    if (!sequence.length) {
      return json(400, { message: "sequence array is required." });
    }

    const item = {
      season,
      ticketId: "_DRAFT_CONFIG",
      itemType: "DRAFT_CONFIG",
      mode: String(body.mode || "snake-quotas"),
      seed: String(body.seed || ""),
      participants,
      baseOrder,
      sequence,
      updatedAt: new Date().toISOString()
    };

    await ddb.send(
      new PutCommand({
        TableName: tables.TICKETS_TABLE,
        Item: item
      })
    );

    await broadcast({ type: "DRAFT_CONFIG_UPDATED", config: item });
    return json(200, { season, saved: true, sequenceLength: sequence.length });
  } catch (err) {
    return json(err.statusCode || 500, { message: err.message || "Internal server error" });
  }
};
