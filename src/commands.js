import { setTimeout } from "timers/promises"; // eslint-disable-line node/no-missing-import
import obs from "./obs/index.js";
import textToSpeech from "./text-to-speech.js";
import {
  getCachedCommands as getCommands,
  getScheduledCommands,
} from "./google-sheet.js";

import saveScreenshotToBrbScreen from "./save-screenshot-to-brb-screen.js";

import { schedule } from "./helpers/schedule.js";
import Logger from "./helpers/logger.js";
const logger = new Logger("🚀 Commands");

class Commands {
  constructor({
    io,
    music,
    streamingService,
    channelInfo,
    alerts,
    redemptions,
  }) {
    this.io = io;
    this.music = music;
    this.streamingService = streamingService;
    this.channelInfo = channelInfo;
    this.alerts = alerts;
    this.redemptions = redemptions.redemptions;

    this.googleSheetCommands = [];

    this.handleRecurringGoogleSheetCommands({ streamingService });

    this.popUpMessage = "";
    this.isThanosDancing = false;
    this.form = "pngtuber";
  }

  async setForm(newForm) {
    this.form = newForm;

    const timeout = 2000;
    obs.turnOnOverlay("Minecraft splash potion", timeout);

    const splashHitTimeout = 1500;
    await setTimeout(splashHitTimeout);

    const redemptionsNotForPNGTuber = this.redemptions.filter(
      (redemption) => {
        return redemption.isNotForPNGTuber === true;
      }
    );

    if (newForm === "pngtuber") {
      redemptionsNotForPNGTuber.forEach((redemption) => {
        this.streamingService.disableRedemption(redemption.id);
      });

      obs.showSource({
        scene: "Raw Webcam",
        source: "veadotube mini (Spout)",
      });
      obs.hideSource({
        scene: "Raw Webcam",
        source: "Snap Camera (Greenscreen)",
      });

      return;
    }

    redemptionsNotForPNGTuber.forEach((redemption) => {
      this.streamingService.enableRedemption(redemption.id);
    });

    obs.hideSource({
      scene: "Raw Webcam",
      source: "veadotube mini (Spout)",
    });
    obs.showSource({
      scene: "Raw Webcam",
      source: "Snap Camera (Greenscreen)",
    });
  }

  async handleRecurringGoogleSheetCommands({ streamingService }) {
    this.googleSheetCommands = await getCommands();
    const scheduledCommands = await getScheduledCommands();

    let currentCommands = 0;
    schedule(15, () => {
      const scheduledCommand = scheduledCommands[currentCommands];
      logger.info(`Running !${scheduledCommand.name}`);
      streamingService.chat.sendMessage(scheduledCommand.value);

      currentCommands += 1;
      if (currentCommands === scheduledCommands.length) {
        currentCommands = 0;
      }
    });
  }

  async updateGoogleSheetCommands() {
    this.googleSheetCommands = await getCommands();
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

  async category({ isMod, isBroadcaster, commandArguments }) {
    if ((isMod || isBroadcaster) && commandArguments.length > 0) {
      try {
        await this.streamingService.setCategory(commandArguments);
      } catch (e) {
        logger.error(e.message);
        this.streamingService.chat.sendMessage(
          `couldn't set the title to "${commandArguments}"`
        );
      }

      return;
    }

    if (!this.channelInfo.category) {
      this.streamingService.chat.sendMessage(
        `they're isn't doing anything... fuck all`
      );
      return;
    }

    if (this.channelInfo.category === "Just Chatting") {
      this.streamingService.chat.sendMessage(
        `they're farting about chatting`
      );
    } else if (this.channelInfo.category === "Makers & Crafting") {
      this.streamingService.chat.sendMessage(
        `they're making something`
      );
    } else {
      this.streamingService.chat.sendMessage(
        `they're playing ${this.channelInfo.category}`
      );
    }
  }

  async title({ isMod, isBroadcaster, commandArguments }) {
    if (
      (isMod || isBroadcaster) &&
      commandArguments.trim().length > 0
    ) {
      await this.streamingService.setTitle(commandArguments);

      return;
    }

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

  async shoutOut({ username }) {
    if (!username || username.length === 0) {
      return;
    }

    if (username.trim().startsWith("@")) {
      username = username.substring(1);
    }

    if (!username || username.length === 0) {
      return;
    }

    let user;
    try {
      user = await this.streamingService.getUser(username);
    } catch (e) {
      logger.error(e.message);
      this.streamingService.chat.sendMessage(
        `couldnt find a user for "${username}"`
      );
      return;
    }

    if (!user) {
      return;
    }

    let nameAudioUrl;
    try {
      nameAudioUrl = await textToSpeech(user.username);
    } catch (e) {
      // couldnt get name audio
    }

    this.alerts.send({
      type: "shout-out",
      duration: 10000,
      delayAudio: 3100,
      user,
      imageUrl: user.image,
      audioUrl: nameAudioUrl,
    });

    this.streamingService.sendChatShoutout(user);

    let nameString;
    if (user.pronouns) {
      nameString = `${user.username} (${user.pronouns})`;
    } else {
      nameString = user.username;
    }
    const urlString = `twitch.tv/${user.username.toLowerCase()}`;
    this.streamingService.sendChatAnnouncement(
      `shout out to ${nameString} - ${urlString}`
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
    if (!messageWithEmotes || messageWithEmotes.length === 0) {
      this.streamingService.chat.sendMessage(
        "you need a message with !say"
      );
    }

    this.alerts.send({
      type: "say",
      duration: 5000,
      message: commandArguments,
      messageWithEmotes: messageWithEmotes.replace("!say", "").trim(),
    });
  }

  thanosDancing() {
    if (this.isThanosDancing) {
      return;
    }

    logger.info("🕺 Thanos dancing triggered...");

    this.isThanosDancing = true;
    const timeout = 15 * 1000;
    obs.turnOnOverlay("Thanos Dancing", timeout);
    setTimeout(() => {
      this.isThanosDancing = false;
    }, timeout);
  }
}

export default Commands;
