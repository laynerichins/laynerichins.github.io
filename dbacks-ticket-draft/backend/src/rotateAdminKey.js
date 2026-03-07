const {
  PutCommand,
  ddb,
  json,
  parseBody,
  assertAdmin,
  hashAdminKey,
  adminKeyItem,
  tables
} = require("./common");

exports.handler = async (event) => {
  try {
    await assertAdmin(event);
    const body = parseBody(event);

    const newAdminKey = String(body.newAdminKey || body.adminKey || "").trim();
    if (!newAdminKey || newAdminKey.length < 8) {
      return json(400, { message: "newAdminKey is required and must be at least 8 characters." });
    }

    const item = {
      season: adminKeyItem.season,
      ticketId: adminKeyItem.ticketId,
      itemType: "ADMIN_KEY",
      adminKeyHash: hashAdminKey(newAdminKey),
      updatedAt: new Date().toISOString()
    };

    await ddb.send(
      new PutCommand({
        TableName: tables.TICKETS_TABLE,
        Item: item
      })
    );

    return json(200, { rotated: true, updatedAt: item.updatedAt });
  } catch (err) {
    return json(err.statusCode || 500, { message: err.message || "Internal server error" });
  }
};
