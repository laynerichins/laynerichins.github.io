const {
  UpdateCommand,
  ddb,
  json,
  parseBody,
  assertAdmin,
  broadcast,
  tables
} = require("./common");

exports.handler = async (event) => {
  try {
    assertAdmin(event);
    const body = parseBody(event);
    if (!body.ticketId) return json(400, { message: "ticketId is required." });

    const season = String(body.season || event?.queryStringParameters?.season || "").trim();
    if (!season) return json(400, { message: "season is required." });

    const out = await ddb.send(
      new UpdateCommand({
        TableName: tables.TICKETS_TABLE,
        Key: { season, ticketId: body.ticketId },
        ConditionExpression: "attribute_exists(ticketId)",
        UpdateExpression: "SET #status = :available, pickedBy = :pickedBy, pickedAt = :pickedAt",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":available": "AVAILABLE",
          ":pickedBy": "",
          ":pickedAt": ""
        },
        ReturnValues: "ALL_NEW"
      })
    );

    await broadcast({ type: "TICKET_UPDATED", ticket: out.Attributes });
    return json(200, { item: out.Attributes });
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      return json(404, { message: "Ticket not found." });
    }
    return json(err.statusCode || 500, { message: err.message || "Internal server error" });
  }
};
