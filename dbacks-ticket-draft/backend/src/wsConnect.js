const { PutCommand, ddb, json, tables } = require("./common");

exports.handler = async (event) => {
  try {
    const connectionId = event?.requestContext?.connectionId;
    if (!connectionId) return { statusCode: 200, body: "No connection ID." };

    await ddb.send(
      new PutCommand({
        TableName: tables.CONNECTIONS_TABLE,
        Item: {
          connectionId,
          connectedAt: new Date().toISOString()
        }
      })
    );

    return { statusCode: 200, body: "Connected." };
  } catch (err) {
    return json(err.statusCode || 500, { message: err.message || "Internal server error" });
  }
};
