const { GetCommand, ddb, json, tables } = require("./common");

exports.handler = async (event) => {
  try {
    const season = String(event?.queryStringParameters?.season || "").trim();
    if (!season) return json(400, { message: "Query parameter 'season' is required." });

    const out = await ddb.send(
      new GetCommand({
        TableName: tables.TICKETS_TABLE,
        Key: { season, ticketId: "_DRAFT_CONFIG" }
      })
    );

    if (!out.Item) {
      return json(200, { config: null });
    }

    return json(200, {
      config: {
        mode: out.Item.mode || "",
        seed: out.Item.seed || "",
        baseOrder: out.Item.baseOrder || [],
        participants: out.Item.participants || [],
        sequence: out.Item.sequence || [],
        updatedAt: out.Item.updatedAt || ""
      }
    });
  } catch (err) {
    return json(err.statusCode || 500, { message: err.message || "Internal server error" });
  }
};