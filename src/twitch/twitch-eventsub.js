import eventSubExpress from "./twitch-eventsub-express.js";

import replaceTextWithEmotes from "./helpers/replace-text-with-emotes.js";
import Logger from "../helpers/logger.js";
const logger = new Logger("🌯 Twitch EventSub");

// https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types
async function TwitchEventSub({ app, twitchApi, eventEmitter }) {
  logger.info("Starting...");
  const expressEvents = eventSubExpress(app);

  async function subscribeToTopic(topic, callback) {
    try {
      expressEvents.on(topic, callback);

      // unsubscribe existing subscription
      const subscriptions =
        await twitchApi.eventSub.getSubscriptions();
      const existingSubscription = subscriptions.find(
        (subscription) => subscription.type === topic
      );
      if (existingSubscription) {
        await twitchApi.eventSub.unsubscribe(existingSubscription.id);
      }

      await twitchApi.eventSub.subscribe(topic);

      logger.info(`${topic} subscription created`);
    } catch (e) {
      logger.error(
        `${topic} failed: ${typeof e === "string" ? e : e.message}`
      );
      logger.error(e);
    }
  }

  const twitchEmotes = await twitchApi.getEmotes();

  // channel point redemptions
  const channelPointRedemptionHandler = async (data) => {
    const {
      id,
      user_id,
      user_name,
      user_input,
      redeemed_at,
      status,
      reward,
    } = data;

    const message = user_input;
    const { messageWithEmotes, messageWithNoEmotes, emoteImages } =
      await replaceTextWithEmotes({ text: message, twitchEmotes });

    const dataEmit = {
      id,
      user: {
        id: user_id,
        username: user_name,
      },
      message,
      messageWithEmotes,
      messageWithNoEmotes,
      emoteImages,
      redeemedAt: redeemed_at,
      reward,
    };

    if (status === "unfulfilled") {
      eventEmitter.emit("channelPointRewardUnfulfilled", dataEmit);
    }

    if (status === "fulfilled") {
      eventEmitter.emit("channelPointRewardFulfilled", dataEmit);
    }

    if (status === "canceled") {
      eventEmitter.emit("channelPointRewardCancelled", dataEmit);
    }
  };

  Promise.allSettled([
    // online/offline
    await subscribeToTopic("stream.online", () => {
      eventEmitter.emit("streamOnline");
    }),
    await subscribeToTopic("stream.offline", () => {
      eventEmitter.emit("streamOffline");
    }),
    // subbies
    await subscribeToTopic("channel.subscribe", (data) => {
      const { user_id, user_name, is_gift } = data;
      eventEmitter.emit("subscribe", {
        isGift: is_gift,
        user: {
          id: user_id,
          username: user_name,
        },
      });
    }),
    // bitties
    await subscribeToTopic("channel.cheer", async (data) => {
      const { user_id, user_name, is_anonymous, message, bits } =
        data;

      const { messageWithEmotes, messageWithNoEmotes } =
        await replaceTextWithEmotes({ text: message, twitchEmotes });

      eventEmitter.emit("bits", {
        isAnonymous: is_anonymous,
        user: {
          id: user_id,
          username: user_name,
        },
        message,
        messageWithEmotes,
        messageWithNoEmotes,
        amount: bits,
      });
    }),
    // updates the category, title
    await subscribeToTopic("channel.update", (data) => {
      const { title, category_id, category_name } = data;
      eventEmitter.emit("channelInfo", {
        title,
        categoryId: category_id,
        categoryName: category_name,
      });
    }),
    await subscribeToTopic(
      "channel.channel_points_custom_reward_redemption.add",
      channelPointRedemptionHandler
    ),
    await subscribeToTopic(
      "channel.channel_points_custom_reward_redemption.update",
      channelPointRedemptionHandler
    ),
  ]);

  return eventEmitter;
}

export default TwitchEventSub;
