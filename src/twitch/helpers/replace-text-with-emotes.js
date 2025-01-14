import fetch from "node-fetch";
import cache from "memory-cache";

const { TWITCH_BROADCASTER_ID } = process.env;

const CACHE_KEY = "BETTER_TTV_EMOTES";
const CACHE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

async function getBetterTTVEmotes() {
  if (!TWITCH_BROADCASTER_ID) {
    return [];
  }

  const response = await fetch(
    `https://api.betterttv.net/3/cached/users/twitch/${TWITCH_BROADCASTER_ID}`
  );
  const json = await response.json();

  if (!json.channelEmotes || !json.sharedEmotes) {
    return [];
  }

  return [...json.channelEmotes, ...json.sharedEmotes].map(
    (emote) => ({
      type: "betterttv",
      id: emote.id,
      image: `https://cdn.betterttv.net/emote/${emote.id}/3x`,
      code: emote.code,
    })
  );
}

async function getCachedBetterTTVEmotes() {
  const cachedBetterTTVEmotes = cache.get(CACHE_KEY);
  if (cachedBetterTTVEmotes) {
    return cachedBetterTTVEmotes;
  }

  const betterTTVEmotes = await getBetterTTVEmotes();

  cache.put(CACHE_KEY, betterTTVEmotes, CACHE_TIMEOUT_MS);

  return betterTTVEmotes;
}

function getTwitchEmotes(text, emotes) {
  if (!emotes || Object.keys(emotes).length === 0) {
    return [];
  }

  const emotePositions = [];

  Object.keys(emotes).forEach((emoteId) => {
    const emoteStringPositions = emotes[emoteId];

    const [emoteStringPosition] = emoteStringPositions;

    if (typeof emoteStringPosition !== "string") {
      return;
    }

    const [emoteStartPositionString, emoteEndPositionString] =
      emoteStringPosition.split("-");
    const emoteStartPosition = parseInt(emoteStartPositionString, 10);
    const emoteEndPosition = parseInt(emoteEndPositionString, 10);

    const emoteText = text.substring(
      emoteStartPosition,
      emoteEndPosition + 1
    );

    emotePositions.push({
      type: "twitch",
      id: emoteId,
      image: `https://static-cdn.jtvnw.net/emoticons/v2/${emoteId}/default/dark/3.0`,
      code: emoteText,
    });
  });

  return emotePositions;
}

function replaceEmotes(text, emotes, { removeEmotes = false } = {}) {
  if (!emotes || emotes.length === 0) {
    return text;
  }

  const textTokens = text.split(" ");

  const newTokens = textTokens.map((textToken) => {
    const emote = emotes.find(({ code }) => code === textToken);
    if (emote) {
      if (removeEmotes) {
        return "";
      }

      const { type, code, image } = emote;
      return `
        <img
          class="emote emote--${type}" 
          src="${image}"
          alt="${code}"
          />
      `.trim();
    }

    return textToken;
  });

  return newTokens.join(" ").trim();
}

function getEmoteImages(text, emotes) {
  if (!emotes || emotes.length === 0) {
    return text;
  }

  const emoteImages = [];

  const textTokens = text.split(" ");
  textTokens.forEach((textToken) => {
    const emote = emotes.find(({ code }) => code === textToken);
    if (emote) {
      emoteImages.push(emote.image);
    }
  });

  return emoteImages;
}

async function replaceTextWithEmotes({
  text,
  twitchEmotes,
  emoteDataFromTwitchBot,
}) {
  if (!text || text.length === 0) {
    return "";
  }

  const betterTTVEmotes = await getCachedBetterTTVEmotes();
  const twitchChannelEmotes =
    twitchEmotes || getTwitchEmotes(text, emoteDataFromTwitchBot);
  const emotes = [...twitchChannelEmotes, ...betterTTVEmotes];

  return {
    messageWithEmotes: replaceEmotes(text, emotes),
    messageWithNoEmotes: replaceEmotes(text, emotes, {
      removeEmotes: true,
    }),
    emoteImages: getEmoteImages(text, emotes),
  };
}

export default replaceTextWithEmotes;
