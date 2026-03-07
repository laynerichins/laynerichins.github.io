const { DeleteCommand, ddb, json, tables } = require("./common");

exports.handler = async (event) => {
  try {
    const connectionId = event?.requestContext?.connectionId;
    if (!connectionId) return { statusCode: 200, body: "No connection ID." };

    await ddb.send(
      new DeleteCommand({
        TableName: tables.CONNECTIONS_TABLE,
        Key: {
          connectionId
        }
      })
    );

    return { statusCode: 200, body: "Disconnected." };
  } catch (err) {
    return json(err.statusCode || 500, { message: err.message || "Internal server error" });
  }
};
