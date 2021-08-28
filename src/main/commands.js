const obs = require("../obs");
const textToSpeech = require("../text-to-speech");
const googleSheet = require("../google-sheet");

const sendFaceDataToClient = require("./send-face-data-to-client");
const saveScreenshotToBrbScreen = require("./save-screenshot-to-brb-screen");
const Alerts = require("./alerts");

const { schedule } = require("../helpers/schedule");
const Logger = require("../helpers/logger");
const logger = new Logger("🚀 Commands");

const { IS_GLIMESH } = process.env;

class Commands {
  constructor({ io, music, streamingService, channelInfo }) {
    this.io = io;
    this.music = music;
    this.streamingService = streamingService;
    this.channelInfo = channelInfo;

    this.alerts = new Alerts({ io });
    this.googleSheetCommands = [];

    this.handleRecurringGoogleSheetCommands({ streamingService });

    this.popUpMessage = "";
  }

  async handleRecurringGoogleSheetCommands({ streamingService }) {
    try {
      this.googleSheetCommands = await googleSheet.getCommands();
      const scheduledCommands =
        await googleSheet.getScheduledCommands();
      scheduledCommands.forEach((scheduledCommand) => {
        logger.info(
          `Running !${scheduledCommand.name} ${scheduledCommand.schedule}`
        );
        schedule(scheduledCommand.schedule, () => {
          streamingService.chat.sendMessage(scheduledCommand.value);
        });
      });
    } catch (e) {
      logger.info("Couldn't run scheduled commands");
    }
  }

  async updateGoogleSheetCommands() {
    this.googleSheetCommands = await googleSheet.getCommands();
  }

  async handleGoogleSheetCommands({ command }) {
    if (!command) {
      return;
    }

    const chatCommand = this.googleSheetCommands.find(
      ({ name }) => command === name
    );
    if (chatCommand) {
      this.streamingService.chat.sendMessage(chatCommand.value);
    }
  }

  async song() {
    const currentTrack = await this.music.getCurrentTrack();

    if (!currentTrack || !currentTrack.isNowPlaying) {
      this.streamingService.chat.sendMessage(
        `SingsNote Nothing is playing...`
      );
      return;
    }

    const { artistName, trackName, albumName, trackUrl } =
      currentTrack;

    if (!artistName || !trackName || !albumName) {
      this.streamingService.chat.sendMessage(
        `SingsNote Nothing is playing...`
      );
      return;
    }

    this.streamingService.chat.sendMessage(
      `SingsNote ${trackName} — ${artistName} — ${albumName} ${trackUrl}`.trim()
    );
  }

  async bex() {
    await sendFaceDataToClient({ io: this.io });
    this.alerts.send({ type: "bexchat" });
  }

  async octopussy() {
    obs.turnOnOverlay("octopussy", 12 * 1000);
  }

  async category() {
    if (!this.channelInfo.category) {
      this.streamingService.chat.sendMessage(
        `zac isn't doing anything... fuck all`
      );
      return;
    }

    if (this.channelInfo.category === "Just Chatting") {
      this.streamingService.chat.sendMessage(
        `zac's farting about chatting`
      );
    } else if (this.channelInfo.category === "Makers & Crafting") {
      this.streamingService.chat.sendMessage(
        `zac's making something`
      );
    } else {
      this.streamingService.chat.sendMessage(
        `zac's playing ${this.channelInfo.category}`
      );
    }
  }

  async switchToBRBScene() {
    logger.info("🗺 Scene change: BRB");
    try {
      const image = await obs.getWebcamImage();
      await saveScreenshotToBrbScreen(image);
      await obs.switchToScene("BRB");
    } catch (e) {
      logger.error(e.message || e);
    }
  }

  async title() {
    if (this.channelInfo.title) {
      this.streamingService.chat.sendMessage(
        `stream title is "${this.channelInfo.title}"`
      );
    } else {
      this.streamingService.chat.sendMessage(
        `there is no stream title`
      );
    }
  }

  async shoutOut({ commandArguments }) {
    if (!commandArguments) {
      return;
    }

    let [username] = commandArguments.split(" ");
    if (!username) {
      return;
    }

    if (username.startsWith("@")) {
      username = username.substring(1);
    }

    if (!username || username.length === 0) {
      return;
    }

    const user = await this.streamingService.getUser(username);

    if (!user) {
      return;
    }

    let nameAudioUrl;
    try {
      nameAudioUrl = await textToSpeech(user.username);
    } catch (e) {
      // couldnt get name audio
    }

    const customShoutOuts =
      await this.streamingService.getCustomShoutOuts();
    const customShoutOut = customShoutOuts.find(
      (shoutOut) => shoutOut.username === user.username.toLowerCase()
    );

    this.alerts.send({
      type: "shout-out",
      user,
      loadImage: user.image,
      customShoutOut,
      audioUrl: nameAudioUrl,
    });

    if (IS_GLIMESH) {
      const urlString = `https://glimesh.tv/${user.username.toLowerCase()}`;
      this.streamingService.chat.sendMessage(
        `:zactopog: shout out to ${user.username} at ${urlString} :zactopog:`
      );
      return;
    }

    let nameString;
    if (customShoutOut) {
      nameString = customShoutOut.message;
    } else if (user.pronouns) {
      nameString = `${user.username} (${user.pronouns})`;
    } else {
      nameString = user.username;
    }

    const urlString = `twitch.tv/${user.username.toLowerCase()}`;

    this.streamingService.chat.sendMessage(
      `shout out to ${nameString} doing something cool over at ${urlString} Squid1 Squid2 zactopUs Squid2 Squid4`
    );
  }

  async setPopUpMessage({ messageWithEmotes }) {
    const newMessage = messageWithEmotes
      .replace("!sign", "")
      .replace("!alert", "")
      .trim();

    if (newMessage.length === 0) {
      return;
    }

    this.io.emit("data", { popUpMessage: newMessage });

    this.popUpMessage = newMessage;
  }

  async deletePopUpMessage() {
    this.popUpMessage = "";
    this.io.emit("data", { popUpMessage: "" });
  }

  async say({ commandArguments, messageWithEmotes }) {
    this.alerts.send({
      type: "say",
      message: commandArguments,
      messageWithEmotes: messageWithEmotes.replace("!say", "").trim(),
    });
  }
}

module.exports = Commands;
