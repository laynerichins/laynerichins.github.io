const { QueryCommand, ddb, json, tables } = require("./common");

exports.handler = async (event) => {
  try {
    const season = String(event?.queryStringParameters?.season || "").trim();
    if (!season) return json(400, { message: "Query parameter 'season' is required." });

    const out = await ddb.send(
      new QueryCommand({
        TableName: tables.TICKETS_TABLE,
        KeyConditionExpression: "season = :season",
        ExpressionAttributeValues: {
          ":season": season
        }
      })
    );

    const items = (out.Items || []).filter((item) => item.itemType !== "DRAFT_CONFIG");
    return json(200, { items });
  } catch (err) {
    return json(err.statusCode || 500, { message: err.message || "Internal server error" });
  }
};