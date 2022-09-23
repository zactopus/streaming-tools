import BaseRedemption from "../base-redemption.js";

import createWordArtImage from "./create-word-art-image.js";
import textToSpeech from "../../text-to-speech.js";

import Logger from "../../helpers/logger.js";
const logger = new Logger("🔠 Redemption: Word Art");

const MINIMUM_ALERT_DURATION = 5000; // 5 secs

function getDuration(text) {
  if (!text || text.length === 0) {
    return 0;
  }

  const DELAY_TIME = 1500; // milliseconds before user starts reading the notification
  const BONUS_TIME = 1000; // extra time
  const WORD_PER_MINUTE = 200; // average words per minute
  const wordAmount = text.split(" ").length;

  if (wordAmount === 0) {
    return DELAY_TIME + BONUS_TIME;
  }

  const wordsTime = (wordAmount / WORD_PER_MINUTE) * 60 * 1000;

  return wordsTime + DELAY_TIME + BONUS_TIME;
}

class WordArtRedemption extends BaseRedemption {
  constructor({ streamingService, alerts }) {
    const title = "word art TTS";

    super({ streamingService, title });

    this.alerts = alerts;
    this.streamingService = streamingService;
    this.data = {
      id: "130650d3-b88e-4b47-9128-c18fc40f5eb5",
      title,
      prompt: "use emojis to change wordart. e.g 🔥 gives fire text",
      cost: 300,
      background_color: "#F2FFD7",
      is_user_input_required: true,
      is_global_cooldown_enabled: true,
      global_cooldown_seconds: 60 * 1, // 1 minutes
    };

    this.fufilledRedemption((data) => this.start(data));
  }

  async start({ messageWithNoEmotes, user }) {
    if (!messageWithNoEmotes || messageWithNoEmotes.length === 0) {
      return;
    }

    logger.log("Triggered...");

    let wordArtImage;
    try {
      wordArtImage = await createWordArtImage(messageWithNoEmotes);
    } catch (e) {
      logger.error(e.message);
      this.streamingService.chat.sendMessage(
        `couldn't send that text sorry @${user?.username}`
      );
      return;
    }

    const duration = Math.max(
      MINIMUM_ALERT_DURATION,
      getDuration(wordArtImage.text)
    );

    let audioUrl;
    try {
      audioUrl = await textToSpeech(wordArtImage.text);
    } catch (e) {
      // couldnt get name audio
    }

    this.alerts.send({
      type: "word-art",
      duration,
      audioUrl,
      imageUrl: wordArtImage.imageUrl,
    });
  }
}

export default WordArtRedemption;
