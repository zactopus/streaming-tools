// get process.env from .env
require("dotenv").config();

const path = require("path");

const { v4: randomID } = require("uuid");
const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const ngrok = require("ngrok");

const { schedule } = require("./src/helpers/schedule");

const logger = require("./src/helpers/logger");

const Music = require("./src/music");
const Twitch = require("./src/twitch");
const KoFi = require("./src/ko-fi");
const googleSheetCommands = require("./src/google-sheet-commands");
const createBeeImage = require("./src/imma-bee/create-bee-image");
const detectFaces = require("./src/helpers/detect-faces");
const saveScreenshotToBrbScreen = require("./src/save-screenshot-to-brb-screen");
const textToSpeech = require("./src/text-to-speech");
const { initialiseHueBulbs } = require("./src/helpers/hue-bulbs");
const {
  getPrideFlag,
  getRandomPrideFlag,
  setLightsToPrideFlag,
} = require("./src/pride-flags");
const obs = require("./src/obs");
const createGoosebumpsBookImage = require("./src/goosebumps");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const { NGROK_AUTH_TOKEN, NGROK_SUBDOMAIN, PORT } = process.env;
const CLIENT_FILE_PATH = "client/build";
let STEVE_HAS_TALKED = false;
let BEX_HAS_TALKED = false;
let POPUP_MESSAGE = "";
let PAUSE_FOLLOW_ALERT = false;
let CURRENT_CHANNEL_INFO = {};
let ALERT_QUEUE = [];
let ALERT_IS_RUNNING = false;
let CURRENT_GOOSEBUMP_BOOK = null;
let CURRENT_PRIDE_FLAG_NAME = "gay";
let CURRENT_DANCERS = [];
let GOOGLE_SHEET_COMMANDS = [];

const ALERT_TYPES = {
  "shout-out": {
    duration: 10000,
    delayAudio: 3100,
  },
  bits: {
    duration: 5000,
  },
  subscribe: {
    duration: 5000,
  },
  donation: {
    duration: 5000,
  },
  follow: {
    duration: 5000,
  },
  say: {
    duration: 5000,
  },
  bigdata: {
    audioUrl: "/assets/alerts/bigdata.mp3",
    duration: 6000,
  },
  immabee: {
    audioUrl: "/assets/alerts/immabee.mp3",
    duration: 4000,
  },
  "fuck-2020": {
    audioUrl: "/assets/alerts/fuck-2020.mp3",
    duration: 3000,
  },
  philpunch: {
    audioUrl: "/assets/alerts/phil-punch.mp3",
    duration: 5000,
    delayAudio: 1000,
  },
  "penguin-throw": {
    audioUrl: "/assets/alerts/penguin-throw-snowball-impact.mp3",
    duration: 2000,
    delayAudio: 900,
  },
  bexchat: {
    audioUrl: "/assets/alerts/bexchat.mp3",
    duration: 10000,
  },
};

function addToAlertQueue(alert) {
  const newAlertQueue = ALERT_QUEUE.concat([alert]);
  ALERT_QUEUE = newAlertQueue;
}

function removeAlertFromQueue(alertId) {
  const newAlertQueue = ALERT_QUEUE.filter(
    (alert) => alert.id !== alertId
  );
  ALERT_QUEUE = newAlertQueue;
}

// serve client files
app.use(express.static(CLIENT_FILE_PATH));

app.get("/", (_request, response) => {
  response.sendFile(
    path.join(__dirname, CLIENT_FILE_PATH, "/index.html")
  );
});

function processAlert() {
  if (ALERT_QUEUE.length === 0) {
    io.emit("data", { alert: {} });
    return;
  }

  // if alert is running we wait for it to finish
  if (ALERT_IS_RUNNING) {
    return;
  }

  ALERT_IS_RUNNING = true;
  const [alert] = ALERT_QUEUE;
  io.emit("data", { alert: {} }); // clear current alert
  io.emit("data", { alert });

  if (alert.duration) {
    setTimeout(() => {
      removeAlertFromQueue(alert.id);
      ALERT_IS_RUNNING = false;

      // get next alert if there
      processAlert();
    }, alert.duration);
  }
}

function sendAlertToClient(options) {
  const alertType = ALERT_TYPES[options.type];
  const alert = {
    id: randomID(),
    ...alertType,
    ...options,
  };
  addToAlertQueue(alert);
  processAlert();
}

async function switchToBRBScene() {
  logger.info("🗺 Scene change", "BRB");
  try {
    const image = await obs.getWebcamImage();
    await saveScreenshotToBrbScreen(image);
    await obs.switchToScene("BRB");
  } catch (e) {
    // didn't find the image
  }
}

async function turnOnOverlay(source, timeout) {
  await obs.hideSource({
    scene: "Overlays",
    source,
  });

  setTimeout(() => {
    obs.showSource({
      scene: "Overlays",
      source,
    });

    if (timeout) {
      setTimeout(() => {
        obs.hideSource({
          scene: "Overlays",
          source,
        });
      }, timeout);
    }
  }, 100); // wait 100 ms i guess
}

async function createNgrokUrl() {
  let ngrokUrl;

  try {
    ngrokUrl = await ngrok.connect({
      addr: PORT,
      authtoken: NGROK_AUTH_TOKEN,
      region: "eu",
      subdomain: NGROK_SUBDOMAIN,
    });
  } catch (e) {
    logger.error("👽 Ngrok", e);
  }

  if (!ngrokUrl) {
    logger.error("👽 Ngrok", "No Ngrok URL");
    process.exit(1); // can't do anything without ngrok
  }

  logger.info("👽 Ngrok", `URL: ${ngrokUrl}`);

  return ngrokUrl;
}

async function main() {
  // reset lights for streaming
  initialiseHueBulbs().catch((error) =>
    logger.error("💡 Hue Bulbs", error)
  );

  // initialise various things
  await obs.initialise();
  const ngrokUrl = await createNgrokUrl();
  const twitch = await Twitch({ ngrokUrl, app });
  const music = Music();
  const kofi = KoFi({ ngrokUrl, app });

  kofi.on("payment", ({ type, isAnonymous, user }) => {
    if (type === "Donation") {
      sendAlertToClient({ type: "donation", user, isAnonymous });
      const userName = isAnonymous ? "bill gates" : user.username;
      twitch.bot.say(`hi ${userName}, thanks for the donation!`);
    }
  });

  async function detectFacesSendToClient() {
    try {
      const image = await obs.getWebcamImage();

      const faceDetection = await detectFaces(image);

      if (!faceDetection) {
        throw new Error("No face detected");
      }

      io.emit("data", { faceDetection });
    } catch (e) {
      // didn't work
    }
  }

  obs.sourceVisibilityTriggers({
    "Joycon: A": async () => {
      return obs.toggleFilter({
        source: "Raw Webcam",
        filter: "Webcam: Recursion Effect",
      });
    },
    "Joycon: B": async () => {
      return obs.toggleFilter({
        source: "Raw Webcam",
        filter: "Webcam: Time Warp Scan",
      });
    },
    "Joycon: Y": async () => {
      return obs.toggleFilter({
        source: "Raw Webcam",
        filter: "Webcam: Trail",
      });
    },
    "Joycon: X": async () => {
      await obs.switchToScene("Dance");
    },
    "Joycon: Right Shoulder": async () => {
      await obs.switchToScene("Dance Multiple");
    },
    "Joycon: Right Trigger": async () => {
      await obs.switchToScene("Dance everywhere");
    },
    "Joycon: Right Analog In": async () => {
      return obs.toggleFilter({
        source: "Raw Webcam",
        filter: "Webcam: Rainbow",
      });
    },
    "Scene change: BRB": async () => switchToBRBScene(),
    "Stop Goosebumps": async () => {
      io.emit("data", { goosebumpsBookTitle: null });
      CURRENT_GOOSEBUMP_BOOK = null;
      await obs.switchToScene("Main Bigger Zac");
    },
  });

  obs.filterVisibilityTriggers({
    "TONOR Microphone": {
      "Mic: Deep Voice": async ({ isVisible }) => {
        return await obs.showHideSource({
          scene: "Overlays",
          source: "MIDI: Bass Spin",
          isVisible,
        });
      },
      "Mic: Delay": async ({ isVisible }) => {
        return await obs.showHideSource({
          scene: "Overlays",
          source: "MIDI: Echo",
          isVisible,
        });
      },
      "Mic: Auto-Loop": async ({ isVisible }) => {
        return await obs.showHideSource({
          scene: "Overlays",
          source: "MIDI: Auto-loop",
          isVisible,
        });
      },
    },
  });

  // set and update channel info
  CURRENT_CHANNEL_INFO = await twitch.getChannelInfo();
  logger.info("🤖 Twitch Bot", "Setting channel info");
  twitch.on("channelInfo", async (channelInfo) => {
    logger.info("🤖 Twitch Bot", "Updating channel info");
    CURRENT_CHANNEL_INFO = channelInfo;
  });

  try {
    GOOGLE_SHEET_COMMANDS = await googleSheetCommands.getCommands();
    const scheduledCommands =
      await googleSheetCommands.getScheduledCommands();
    scheduledCommands.forEach((scheduledCommand) => {
      logger.info(
        "🤖 Twitch Bot",
        `Running !${scheduledCommand.name} ${scheduledCommand.schedule}`
      );
      schedule(scheduledCommand.schedule, () => {
        twitch.bot.say(scheduledCommand.value);
      });
    });
  } catch (e) {
    logger.info("🤖 Twitch Bot", "Couldn't run scheduled commands");
  }

  twitch.on("subscribe", (data) => {
    sendAlertToClient({ type: "subscribe", ...data });

    if (data.isGift) {
      twitch.bot.say(
        `thanks for gifting a sub to @${data.user.username}`
      );
      return;
    }

    twitch.bot.say(`hi @${data.user.username}, thanks for the sub!`);
  });

  twitch.on("bits", (data) => {
    sendAlertToClient({ type: "bits", ...data });
    const userName = data.isAnonymous
      ? "bill gates"
      : `@${data.user.username}`;
    twitch.bot.say(`hi ${userName}, thanks for the bits!`);
  });

  twitch.on("follow", async (user) => {
    if (PAUSE_FOLLOW_ALERT) {
      return;
    }

    sendAlertToClient({ type: "follow", user });
    twitch.bot.say(`hi @${user.username}, thanks for following!`);

    // update follow total
    const followTotal = await twitch.getFollowTotal();
    io.emit("data", { followTotal });
  });

  twitch.on("raid", async (user) => {
    if (user.viewers > 50) {
      PAUSE_FOLLOW_ALERT = true;
      twitch.bot.say("big raid, follow alerts paused for 5 mins");
      setTimeout(() => {
        PAUSE_FOLLOW_ALERT = false;
        twitch.bot.say("follow alerts will happen again chief");
      }, 5 * 60 * 1000); // after 5 minutes resume again
    }

    let raidAudioUrl;
    try {
      raidAudioUrl = await textToSpeech(
        `oh shit here's ${user.username}`
      );
    } catch (e) {
      // couldnt get name audio
    }

    sendAlertToClient({ type: "raid", user, audioUrl: raidAudioUrl });
    twitch.bot.say(
      `hi @${user.username}, thanks for the raid! hi to the ${user.viewers} raiders.`
    );
  });

  twitch.on("channelPointRewardUnfulfilled", async ({ reward }) => {
    const { title } = reward;

    if (!title) {
      return;
    }

    if (title === "big drink") {
      await obs.showSource({
        scene: "Overlays",
        source: "Amelia Water Loop",
      });
    }
  });

  twitch.on("channelPointRewardCancelled", async ({ reward }) => {
    const { title } = reward;

    if (!title) {
      return;
    }

    if (title === "big drink") {
      await obs.hideSource({
        scene: "Overlays",
        source: "Amelia Water Loop",
      });
    }
  });

  twitch.on(
    "channelPointRewardFulfilled",
    async ({ reward, user }) => {
      const { title } = reward;
      const { message } = user;

      if (!title) {
        return;
      }

      if (title === "dance with zac") {
        const newDancer = await twitch.getUser(user.username);
        newDancer.id = randomID();
        CURRENT_DANCERS.push(newDancer);

        io.emit("data", { dancers: CURRENT_DANCERS });

        setTimeout(() => {
          // remove from array
          CURRENT_DANCERS = CURRENT_DANCERS.filter((dancer) => {
            dancer.id !== newDancer.id;
          });
          io.emit("data", { dancers: CURRENT_DANCERS });
        }, 1000 * 60 * 3 + 5000); // 2 minutes (+ wait for it to fade out on client)
      }

      if (title === "pog") {
        turnOnOverlay("Steve Pointing Group", 9 * 1000);
        twitch.bot.say("thanks twitch.tv/blgsteve for the pog audit");
      }

      if (title === "big drink") {
        await obs.hideSource({
          scene: "Overlays",
          source: "Amelia Water Loop",
        });

        twitch.bot.say(
          "Shout out to twitch.tv/ameliabayler the water singer"
        );
      }

      if (title === "show your pride") {
        const inputPrideFlagName = message;

        if (inputPrideFlagName === "straight") {
          const { username } = user;
          twitch.bot.say("Ok mate... straight pride doesn't exist.");
          twitch.bot.timeout({
            username,
            lengthSeconds: 60,
            reason: "Trying to chat shit about straight pride",
          });
          return;
        }

        const prideFlag = getPrideFlag(inputPrideFlagName);

        if (prideFlag) {
          CURRENT_PRIDE_FLAG_NAME = prideFlag.name;
          setLightsToPrideFlag(prideFlag.name);
          io.emit("data", { prideFlagName: prideFlag.name });
          if (prideFlag.twitchEmote) {
            twitch.bot.say(`${prideFlag.twitchEmote} `.repeat(5));
          }
        } else {
          const randomPrideFlagName = getRandomPrideFlag().name;
          twitch.bot.say(
            [
              inputPrideFlagName.length > 0
                ? `Didn't find anything for "${inputPrideFlagName}". :-(`
                : "",
              `Try something like: !pride ${randomPrideFlagName}`,
            ].join(" ")
          );
        }
      }

      if (title === "imma bee") {
        logger.log("🐝 Imma bee", "Triggered...");

        try {
          const image = await obs.getWebcamImage();
          await createBeeImage(image);
          sendAlertToClient({ type: "immabee" });
        } catch (e) {
          logger.error("🐝 Imma bee", JSON.stringify(e));
          twitch.bot.say(`Couldn't find Zac's face...`);
        }
      }

      if (title === "big data") {
        logger.log("😎 Big Data", "Triggered...");
        sendAlertToClient({ type: "bigdata" });
      }

      if (title === "ally phil") {
        logger.log("🥊 Phil Punch", "Triggered...");
        sendAlertToClient({ type: "philpunch", message });
      }

      if (title === "SPACE") {
        logger.log("🌌 SPACE", "Triggered...");
        turnOnOverlay("Star Trek Space Video", 103 * 1000);
        setTimeout(() => {
          turnOnOverlay("Star Trek Slideshow", 53 * 1000);
          twitch.bot.say(
            `hip hop star trek by d-train https://www.youtube.com/watch?v=oTRKrzgVe6Y`
          );
        }, 50 * 1000); // minute into the video
      }

      if (title === "snowball") {
        logger.log("❄ Snowball", "Triggered...");
        await detectFacesSendToClient();
        sendAlertToClient({ type: "penguin-throw" });
      }

      if (title === "barry") {
        logger.log(" Barry", "Triggered...");
        turnOnOverlay("Barry Singing", 104 * 1000);
      }

      if (title === "BroomyJagRace") {
        logger.log("🚗 BroomyJagRace", "Triggered...");
        turnOnOverlay("BroomyJagRace");
      }

      if (title === "goosebumpz book") {
        logger.log("📚 Goosebumps Book", "Triggered...");
        try {
          const { bookTitle } = await createGoosebumpsBookImage(
            message
          );
          io.emit("data", { goosebumpsBookTitle: bookTitle });
          CURRENT_GOOSEBUMP_BOOK = bookTitle;
          await obs.switchToScene("Goosebumps");
        } catch (e) {
          logger.error("📚 Goosebumps Book", e);
          twitch.bot.say(`Couldn't generate a book for ${message}`);
          CURRENT_GOOSEBUMP_BOOK = null;
        }
      }
    }
  );

  twitch.on(
    "message",
    async ({
      isMod,
      isBroadcaster,
      message,
      messageWithEmotes,
      command,
      commandArguments,
      user,
    }) => {
      if (command === "!song" || command === "!music") {
        const currentTrack = await music.getCurrentTrack();

        if (!currentTrack || !currentTrack.isNowPlaying) {
          twitch.bot.say(`SingsNote Nothing is playing...`);
          return;
        }

        const { artistName, trackName, albumName, trackUrl } =
          currentTrack;

        if (!artistName || !trackName || !albumName) {
          twitch.bot.say(`SingsNote Nothing is playing...`);
          return;
        }

        twitch.bot.say(
          `SingsNote ${trackName} — ${artistName} — ${albumName} ${trackUrl}`.trim()
        );
      }

      const bexTalksForFirstTime =
        !BEX_HAS_TALKED &&
        user &&
        user.username.toLowerCase() === "bexchat";
      const bexCommandUsed =
        command === "!bex" || command === "!bexchat";
      if (bexTalksForFirstTime) {
        BEX_HAS_TALKED = true;
      }
      if (bexTalksForFirstTime || bexCommandUsed) {
        await detectFacesSendToClient();
        sendAlertToClient({ type: "bexchat" });
      }

      if (
        !STEVE_HAS_TALKED &&
        user &&
        user.username.toLowerCase() === "blgsteve"
      ) {
        STEVE_HAS_TALKED = true;
        turnOnOverlay("octopussy", 12 * 1000);
      }
      if (command === "!steve") {
        turnOnOverlay("octopussy", 12 * 1000);
      }

      if (command === "!2020") {
        sendAlertToClient({ type: "fuck-2020" });
      }

      if (command === "!game" || command === "!category") {
        const { categoryName } = CURRENT_CHANNEL_INFO;
        if (categoryName) {
          if (categoryName === "Just Chatting") {
            twitch.bot.say(`zac's farting about chatting`);
          } else if (categoryName === "Makers & Crafting") {
            twitch.bot.say(`zac's making something`);
          } else {
            twitch.bot.say(`zac's playing ${categoryName}`);
          }
        } else {
          twitch.bot.say(`zac isn't doing anything... fuck all`);
        }
      }

      if (command === "!title") {
        if (CURRENT_CHANNEL_INFO.title) {
          twitch.bot.say(
            `stream title is "${CURRENT_CHANNEL_INFO.title}"`
          );
        } else {
          twitch.bot.say(`there is no stream title`);
        }
      }

      // the mod/broadcaster zooone
      if (isMod || isBroadcaster) {
        if (command === "!sign" || command === "!alert") {
          const newMessage = messageWithEmotes
            .replace("!sign", "")
            .replace("!alert", "")
            .trim();

          if (newMessage.length === 0) {
            return;
          }

          io.emit("data", { popUpMessage: newMessage });

          POPUP_MESSAGE = newMessage;
        }

        if (command === "!delete") {
          POPUP_MESSAGE = "";
          io.emit("data", { popUpMessage: "" });
        }

        if (command === "!deletebook") {
          io.emit("data", { goosebumpsBookTitle: null });
          CURRENT_GOOSEBUMP_BOOK = null;
          await obs.switchToScene("Main Bigger Zac");
        }

        if (command === "!follows") {
          if (PAUSE_FOLLOW_ALERT) {
            PAUSE_FOLLOW_ALERT = false;
            twitch.bot.say(
              "follow alerts will happen again now phew"
            );
          } else {
            PAUSE_FOLLOW_ALERT = true;
            twitch.bot.say("follow alerts paused for 5 mins");
            setTimeout(() => {
              PAUSE_FOLLOW_ALERT = false;
              twitch.bot.say("follow alerts will happen again");
            }, 5 * 60 * 1000); // after 5 minutes resume again
          }
        }

        if (command === "!say") {
          sendAlertToClient({
            type: "say",
            message: commandArguments,
            messageWithEmotes: messageWithEmotes
              .replace("!say", "")
              .trim(),
          });
        }

        if (command === "!brb") {
          await switchToBRBScene();
        }

        if (command === "!title") {
          const newTitle = commandArguments;
          if (!newTitle) {
            return;
          }

          try {
            await twitch.setChannelInfo({ title: newTitle });
          } catch (e) {
            twitch.bot.say(e.message);
          }
        }

        if (command === "!test-follow") {
          sendAlertToClient({
            type: "follow",
            user: { username: "ninja" },
          });
        }

        if (
          command === "!so" ||
          command === "!shoutout" ||
          command === "!shout-out"
        ) {
          let shoutOutUsername = commandArguments;
          if (!shoutOutUsername) {
            return;
          }

          if (shoutOutUsername.startsWith("@")) {
            shoutOutUsername = shoutOutUsername.substring(1);
          }

          if (!shoutOutUsername || shoutOutUsername.length === 0) {
            return;
          }

          const shoutOutUser = await twitch.getUser(shoutOutUsername);

          if (!shoutOutUser) {
            return;
          }

          const customShoutOuts = await twitch.getCustomShoutOuts();
          const customShoutOut = customShoutOuts.find(
            (shoutOut) =>
              shoutOut.username ===
              shoutOutUser.username.toLowerCase()
          );

          let nameAudioUrl;
          try {
            nameAudioUrl = await textToSpeech(shoutOutUser.username);
          } catch (e) {
            // couldnt get name audio
          }

          sendAlertToClient({
            type: "shout-out",
            user: shoutOutUser,
            loadImage: shoutOutUser.image,
            customShoutOut,
            audioUrl: nameAudioUrl,
          });

          let nameString;
          if (customShoutOut) {
            nameString = customShoutOut.message;
          } else if (shoutOutUser.pronouns) {
            nameString = `${shoutOutUser.username} (${shoutOutUser.pronouns})`;
          } else {
            nameString = shoutOutUser.username;
          }

          const urlString = `twitch.tv/${shoutOutUser.username.toLowerCase()}`;

          twitch.bot.say(
            `shout out to ${nameString} doing something cool over at ${urlString} Squid1 Squid2 zactopUs Squid2 Squid4`
          );
        }
      }

      const chatCommand = GOOGLE_SHEET_COMMANDS.find(
        (c) => command === `!${c.name}`
      );
      if (chatCommand) {
        twitch.bot.say(chatCommand.value);
      }

      io.emit("data", {
        message,
        messageWithEmotes,
      });
    }
  );

  music.on("track", (track) => {
    io.emit("data", { track });
  });

  io.on("connection", async (socket) => {
    logger.info("👽 Stream Client", "Connected");

    const followTotal = await twitch.getFollowTotal();
    const currentTrack = await music.getCurrentTrack();
    io.emit("data", {
      track: currentTrack,
      followTotal,
      popUpMessage: POPUP_MESSAGE,
      goosebumpsBookTitle: CURRENT_GOOSEBUMP_BOOK,
      prideFlagName: CURRENT_PRIDE_FLAG_NAME,
      dancers: CURRENT_DANCERS,
    });

    socket.on("disconnect", () => {
      logger.info("👽 Stream Client", "Disconnected");
    });
  });
}

main();

server.listen(PORT, () => {
  logger.info(
    "🛸 Stream Server",
    `Listening on http://localhost:${PORT}`
  );
});
