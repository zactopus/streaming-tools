const OBSWebSocket = require("obs-websocket-js");

const logger = require("./helpers/logger");

const obs = new OBSWebSocket();

const { OBS_WEBSOCKET_ADDRESS, OBS_WEBSOCKET_PASSWORD } = process.env;

const GLOBAL_KEY_MODIFIERS = { alt: true };

// https://github.com/obsproject/obs-studio/blob/master/libobs/obs-hotkeys.h
const TRIGGER_SOURCES = [
  {
    name: "steve",
    description: "octopussy ffs",
    hotKeyOptions: {
      keyId: "OBS_KEY_BRACKETRIGHT", // ]
      keyModifiers: GLOBAL_KEY_MODIFIERS,
    },
  },
  {
    name: "space",
    description: "star trek vid",
    hotKeyOptions: {
      keyId: "OBS_KEY_NUMASTERISK", // NUM KEY *
      keyModifiers: GLOBAL_KEY_MODIFIERS,
    },
  },
  {
    name: "star-trek-slideshow",
    description: "star trek slideshow",
    hotKeyOptions: {
      keyId: "OBS_KEY_NUMSLASH", // NUM KEY /
      keyModifiers: GLOBAL_KEY_MODIFIERS,
    },
    dontResetTriggers: true,
  },
  {
    name: "barry",
    description: "barry singing",
    hotKeyOptions: {
      keyId: "OBS_KEY_NUMPERIOD", // NUM KEY .
      keyModifiers: GLOBAL_KEY_MODIFIERS,
    },
  },
];

let OBS_INITIALISED = false;
let AVAILABLE_OBS_REQUESTS = [];

function getTriggerSource(triggerName) {
  return TRIGGER_SOURCES.find(
    (trigger) => trigger.name === triggerName
  );
}

function request(requestName, options) {
  if (!AVAILABLE_OBS_REQUESTS.includes(requestName)) {
    logger.debug(
      "☢ OBS",
      "AVAILABLE_OBS_REQUESTS",
      AVAILABLE_OBS_REQUESTS
    );
    logger.debug(
      "☢ OBS",
      ["Available requests:", ...AVAILABLE_OBS_REQUESTS].join("\n")
    );
    return Promise.reject(
      new Error(`"${requestName}" is not an available request.`)
    );
  }

  return obs.send(requestName, options);
}

function initialise() {
  logger.info("☢ OBS", "Connecting...");

  return new Promise((resolve) => {
    if (OBS_INITIALISED) {
      return resolve();
    }

    obs
      .connect({
        address: OBS_WEBSOCKET_ADDRESS,
        password: OBS_WEBSOCKET_PASSWORD,
      })
      .catch((e) => logger.error("☢ OBS", e.error));

    obs.on("ConnectionOpened", () => {
      obs.send("GetVersion").then((versionInfo) => {
        logger.info("☢ OBS", "Connected!");

        AVAILABLE_OBS_REQUESTS = versionInfo.availableRequests.split(
          ","
        );
        logger.info(
          "☢ OBS",
          `Version ${versionInfo.obsStudioVersion}`
        );
        logger.info(
          "☢ OBS",
          `obs-websocket version ${versionInfo.obsWebsocketVersion}`
        );

        // reset any triggers
        resetTriggers();

        OBS_INITIALISED = true;
        return resolve();
      });
    });
  });
}

async function getWebcamImage(sourceName) {
  const webcamScreenshot = await request("TakeSourceScreenshot", {
    sourceName,
    embedPictureFormat: "jpg",
  });
  return webcamScreenshot.img;
}

async function switchToScene(sceneName) {
  return request("SetCurrentScene", {
    "scene-name": sceneName,
  });
}

async function resetTriggers() {
  return await request("TriggerHotkeyBySequence", {
    keyId: "OBS_KEY_NUM5",
  });
}

async function showSource({ scene, source }) {
  return await request("SetSceneItemRender", {
    "scene-name": scene,
    source,
    render: true,
  });
}

async function hideSource({ scene, source }) {
  return await request("SetSceneItemRender", {
    "scene-name": scene,
    source,
    render: false,
  });
}

async function toggleOnOffHotKey({
  dontResetTriggers,
  hotKeyOptions,
}) {
  if (!dontResetTriggers) await resetTriggers();
  setTimeout(async () => {
    await request("TriggerHotkeyBySequence", hotKeyOptions);
  }, 100); // need to time out for this to work
}

function handleTriggers(command) {
  const triggerSource = getTriggerSource(command);

  if (!triggerSource) {
    return;
  }

  logger.info("☢ OBS", `Triggering "${triggerSource.name}"...`);
  toggleOnOffHotKey(triggerSource);
}

async function midiTriggers(triggers) {
  obs.on(
    "SceneItemVisibilityChanged",
    ({ itemVisible, itemName }) => {
      if (!Object.prototype.hasOwnProperty.call(triggers, itemName)) {
        return;
      }

      triggers[itemName]({ isVisible: itemVisible });
    }
  );
}

module.exports = {
  TRIGGER_SOURCES,
  initialise,
  getWebcamImage,
  handleTriggers,
  resetTriggers,
  switchToScene,
  midiTriggers,
  showSource,
  hideSource,
};
