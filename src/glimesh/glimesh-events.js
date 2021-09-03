const { EventEmitter } = require("events");
const WebSocket = require("ws");
const Logger = require("../helpers/logger");

const logger = new Logger("▶️ Glimesh");

const replaceTextWithEmotes = require("./helpers/replace-text-with-emotes");

let IS_CONNECTED = false;
const SUBSCRIPTIONS = {};

function getCommand(message) {
  if (!message || !message.startsWith("!")) {
    return {};
  }

  const [command, ...commandArguments] = message
    .substring(1)
    .split(" ");

  return {
    command: command.toLowerCase(),
    commandArguments: commandArguments.join(" ").trim(),
  };
}

const { GLIMESH_BROADCASTER_ID, GLIMESH_BROADCASTER_NAME } =
  process.env;

async function GlimeshEvents({ accessToken, moderators }) {
  const eventEmitterChat = new EventEmitter();

  const connection = new WebSocket(
    `wss://glimesh.tv/api/socket/websocket?vsn=2.0.0&token=${accessToken}`
  );

  function sendWebsocketMessage(message) {
    return connection.send(JSON.stringify(message));
  }

  function sendQuery(id, query) {
    return sendWebsocketMessage([
      "1",
      id,
      "__absinthe__:control",
      "doc",
      {
        query: query.trim(),
        variables: {},
      },
    ]);
  }

  function getMessage(data, isBinary) {
    let message = isBinary ? data : data.toString();
    try {
      const json = JSON.parse(data);
      message = json[json.length - 1];
      message.type = json[1];
    } catch (e) {
      // ...
    }
    return message;
  }

  function startHeartbeat() {
    setInterval(() => {
      sendWebsocketMessage(["1", "1", "phoenix", "heartbeat", {}]);
    }, 20 * 1000); // every 20 seconds
  }

  function checkHasSubscribedTo(type, message, callback) {
    if (SUBSCRIPTIONS[type]) {
      return;
    }

    if (
      message.status &&
      message.status === "ok" &&
      message.response.subscriptionId &&
      message.type == type
    ) {
      SUBSCRIPTIONS[type] = message.response.subscriptionId;
      callback();
    }
  }

  function subscribeToChatMessages() {
    sendQuery(
      "chat",
      `
        subscription {
          chatMessage(channelId: ${GLIMESH_BROADCASTER_ID}) {
            id
            message
            user {
              id
              username
              avatarUrl
            }
            tokens {
              text
              type
              ... on EmoteToken {
                src
                text
                type
              }
              ... on TextToken {
                text
                type
              }
              ... on UrlToken {
                text
                type
                url
              }
            }
          }
        }
      `
    );
  }

  function checkForSuccessfulSend(message) {
    if (IS_CONNECTED) {
      return;
    }

    if (message.status && message.status === "ok") {
      IS_CONNECTED = true;

      startHeartbeat();
      subscribeToChatMessages();
    }
  }

  async function handleChatMessage({ id, user, message, tokens }) {
    const isMod = moderators.some(
      (modUsername) =>
        modUsername.toLowerCase() === user.username.toLowerCase()
    );
    const isBroadcaster = user.username === GLIMESH_BROADCASTER_NAME;

    const { command, commandArguments } = getCommand(message);

    const messageWithEmotes = await replaceTextWithEmotes(
      message,
      tokens
    );

    eventEmitterChat.emit("message", {
      id,
      isMod,
      isBroadcaster,
      message: message.trim(),
      messageWithEmotes,
      command,
      commandArguments,
      user: {
        id: user.id,
        username: user.username,
        image: user.avatarUrl,
      },
      tokens,
    });
  }

  connection.on("message", async (data, isBinary) => {
    const message = getMessage(data, isBinary);
    logger.debug(message);

    if (!message) {
      return;
    }

    checkForSuccessfulSend(message);

    if (!IS_CONNECTED) {
      return;
    }

    checkHasSubscribedTo("chat", message, () => {
      eventEmitterChat.emit("join");
    });

    if (
      SUBSCRIPTIONS["chat"] &&
      SUBSCRIPTIONS["chat"] === message.subscriptionId
    ) {
      try {
        await handleChatMessage(message.result.data.chatMessage);
      } catch (error) {
        logger.error(error.message);
      }
    }
  });

  connection.on("open", () => {
    sendWebsocketMessage([
      "1",
      "1",
      "__absinthe__:control",
      "phx_join",
      {},
    ]);
  });

  function sendMessage(message) {
    sendQuery(
      "chat",
      `
        mutation {
          createChatMessage(channelId: ${GLIMESH_BROADCASTER_ID}, message: { message: "${message}" }) {
            message
          }
        }
      `
    );
  }

  function deleteMessage(messageId) {
    sendQuery(
      "chat",
      `
        mutation {
          deleteMessage(channelId: ${GLIMESH_BROADCASTER_ID}, messageId: ${messageId}) {
            action,
            moderator {displayname}
          }
        }
      `
    );
  }

  return {
    chat: Object.assign(eventEmitterChat, {
      sendMessage,
      deleteMessage,
    }),
  };
}

module.exports = GlimeshEvents;
