import crypto from "crypto";
import { EventEmitter } from "events";

import Logger from "../helpers/logger.js";
const logger = new Logger("🌯 Twitch EventSub");

let RECENT_EVENTSUB_MESSAGES = [];
const IGNORE_DUPLICATE_EVENTSUB_MESSAGES = true;
const IGNORE_OLD_MESSAGES = true;
const { TWITCH_EVENTSUB_SECRET } = process.env;

const TWITCH_MESSAGE_ID = "Twitch-Eventsub-Message-Id".toLowerCase();
const TWITCH_MESSAGE_TIMESTAMP =
  "Twitch-Eventsub-Message-Timestamp".toLowerCase();
const TWITCH_MESSAGE_SIGNATURE =
  "Twitch-Eventsub-Message-Signature".toLowerCase();
const HMAC_PREFIX = "sha256=";

function getHmacMessage(request) {
  return (
    request.headers[TWITCH_MESSAGE_ID] +
    request.headers[TWITCH_MESSAGE_TIMESTAMP] +
    JSON.stringify(request.body)
  );
}

// Get the HMAC.
function getHmac(secret, message) {
  return crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");
}

// Verify whether your signature matches Twitch's signature.
function verifyMessage(hmac, verifySignature) {
  return crypto.timingSafeEqual(
    Buffer.from(hmac),
    Buffer.from(verifySignature)
  );
}

function verifyEventSubSCallback(request, response, next) {
  logger.debug("Verifying webhook request");

  let message = getHmacMessage(request);
  let hmac = HMAC_PREFIX + getHmac(TWITCH_EVENTSUB_SECRET, message);

  if (
    true ===
    verifyMessage(hmac, request.headers[TWITCH_MESSAGE_SIGNATURE])
  ) {
    // Handle notification.
    request.isFromTwitch = true;
    next();
  } else {
    response.sendStatus(403);
  }
}

function eventSubExpress(app) {
  const eventEmitter = new EventEmitter();

  app.post(
    "/eventSubCallback",
    verifyEventSubSCallback,
    (request, response) => {
      if (!request.isFromTwitch) {
        logger.error(
          "Received unauthorized request to webhooks endpoint"
        );
        response
          .status(401)
          .send("Unauthorized request to EventSub webhook");
        return;
      }

      if (request.twitchSignature !== request.calculatedSignature) {
        logger.error(
          `Request message signature ${request.twitchSignature} does not match calculated signature ${request.calculatedSignature}`
        );
        response.status(403).send("Request signature mismatch");
        return;
      }

      if (
        Object.prototype.hasOwnProperty.call(
          request.body,
          "challenge"
        ) &&
        request.headers["twitch-eventsub-message-type"] ===
          "webhook_callback_verification"
      ) {
        logger.debug(
          `Received challenge for ${request.body.subscription.type}, ${request.body.subscription.id}. Returning challenge.`
        );
        logger.info(
          `${request.body.subscription.type} subscription successful`
        );
        response
          .status(200)
          .type("text/plain")
          .send(encodeURIComponent(request.body.challenge)); // ensure plain string response
        return;
      }

      // if normal event, send OK and handle event
      response.status(200).send("OK");

      // handle dupes and old messages (per config)
      let canFire = true;

      const messageId = request.headers["twitch-eventsub-message-id"];

      if (
        IGNORE_DUPLICATE_EVENTSUB_MESSAGES &&
        RECENT_EVENTSUB_MESSAGES[messageId]
      ) {
        logger.debug(
          `Received duplicate notification with message id ${messageId}`
        );
        canFire = false;
      }

      const messageAge =
        Date.now() -
        new Date(
          request.headers["twitch-eventsub-message-timestamp"]
        );

      if (IGNORE_OLD_MESSAGES && messageAge > 600000) {
        logger.debug(
          `Received old notification with message id ${messageId}`
        );
        canFire = false;
      }

      if (!canFire) {
        return;
      }

      // handle different message types
      switch (request.headers["twitch-eventsub-message-type"]) {
        case "notification":
          logger.log(
            `Received notification for type ${request.body.subscription.type}`
          );
          RECENT_EVENTSUB_MESSAGES[messageId] = true;

          setTimeout(() => {
            delete RECENT_EVENTSUB_MESSAGES[messageId];
          }, 601000);

          eventEmitter.emit(
            request.body.subscription.type,
            request.body.event
          );

          break;
        case "revocation":
          logger.log(
            `Received revocation notification for subscription id ${request.body.subscription.id}`
          );
          RECENT_EVENTSUB_MESSAGES[messageId] = true;
          setTimeout(() => {
            delete RECENT_EVENTSUB_MESSAGES[messageId];
          }, 601000);

          eventEmitter.emit("revocation", request.body.subscription);

          break;
        default:
          logger.log(
            `Received request with unhandled message type ${request.headers["twitch-eventsub-message-type"]}`
          );
          break;
      }
    }
  );

  return eventEmitter;
}

export default eventSubExpress;
