import OBSWebSocket from "obs-websocket-js";

import Logger from "../helpers/logger.js";
const logger = new Logger("☢ OBS");

const obs = new OBSWebSocket();

const { OBS_WEBSOCKET_ADDRESS, OBS_WEBSOCKET_PASSWORD } = process.env;

let OBS_INITIALISED = false;
let AVAILABLE_OBS_REQUESTS = [];

function request(requestName, options) {
  if (!AVAILABLE_OBS_REQUESTS.includes(requestName)) {
    logger.debug("AVAILABLE_OBS_REQUESTS", AVAILABLE_OBS_REQUESTS);
    logger.debug(
      ["Available requests:", ...AVAILABLE_OBS_REQUESTS].join("\n")
    );
    return Promise.reject(
      new Error(`"${requestName}" is not an available request.`)
    );
  }

  return obs.send(requestName, options);
}

function initialise() {
  logger.info("Connecting...");

  return new Promise((resolve) => {
    if (OBS_INITIALISED) {
      return resolve();
    }

    try {
      obs.connect({
        address: OBS_WEBSOCKET_ADDRESS,
        password: OBS_WEBSOCKET_PASSWORD,
      });
    } catch (e) {
      logger.error(e.error || e.message || e);
    }

    obs.on("ConnectionOpened", () => {
      obs.send("GetVersion").then((versionInfo) => {
        logger.info("Connected!");

        AVAILABLE_OBS_REQUESTS =
          versionInfo.availableRequests.split(",");
        logger.info(`Version ${versionInfo.obsStudioVersion}`);
        logger.info(
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
  if (!OBS_INITIALISED) {
    throw new Error("OBS isn't ready");
  }

  let webcamScreenshot;
  try {
    webcamScreenshot = await request("TakeSourceScreenshot", {
      sourceName,
      embedPictureFormat: "png",
    });
  } catch (e) {
    throw new Error(e.error || e);
  }

  return webcamScreenshot?.img;
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

async function showHideSource({ scene, source, isVisible }) {
  if (!OBS_INITIALISED) {
    throw new Error("OBS isn't ready");
  }

  return await request("SetSceneItemRender", {
    "scene-name": scene,
    source,
    render: isVisible,
  });
}

async function showSource({ scene, source }) {
  if (!OBS_INITIALISED) {
    throw new Error("OBS isn't ready");
  }

  return await showHideSource({ scene, source, isVisible: true });
}

async function hideSource({ scene, source }) {
  if (!OBS_INITIALISED) {
    throw new Error("OBS isn't ready");
  }

  return await showHideSource({ scene, source, isVisible: false });
}

async function showHideFilter({ source, filter, filterEnabled }) {
  if (!OBS_INITIALISED) {
    throw new Error("OBS isn't ready");
  }

  return await request("SetSourceFilterVisibility", {
    sourceName: source,
    filterName: filter,
    filterEnabled,
  });
}

async function toggleFilter({ source, filter }) {
  if (!OBS_INITIALISED) {
    throw new Error("OBS isn't ready");
  }

  const result = await request("GetSourceFilterInfo", {
    sourceName: source,
    filterName: filter,
  });

  return await showHideFilter({
    source,
    filter,
    filterEnabled: !result.enabled,
  });
}

async function handleTriggers({ triggers, itemVisible, itemName }) {
  if (!Object.prototype.hasOwnProperty.call(triggers, itemName)) {
    return;
  }

  const triggerFunction = triggers[itemName];

  try {
    return await triggerFunction({ isVisible: itemVisible });
  } catch (e) {
    logger.error(e);
  }
}

async function sourceVisibilityTriggers(triggers) {
  obs.on("SceneItemVisibilityChanged", ({ itemVisible, itemName }) =>
    handleTriggers({ triggers, itemVisible, itemName })
  );
}

async function filterVisibilityTriggers(sourcesObject) {
  const sources = Object.keys(sourcesObject);
  sources.forEach(async (source) => {
    const triggers = sourcesObject[source];
    const { filters } = await request("GetSourceFilters", {
      sourceName: source,
    });

    filters.forEach(async (filter) => {
      await handleTriggers({
        triggers,
        itemVisible: filter.enabled,
        itemName: filter.name,
      });
    });

    obs.on(
      "SourceFilterVisibilityChanged",
      ({ filterEnabled, filterName }) =>
        handleTriggers({
          triggers,
          itemVisible: filterEnabled,
          itemName: filterName,
        })
    );
  });
}

async function turnOnOverlay(source, timeout) {
  await hideSource({
    scene: "Overlays",
    source,
  });

  setTimeout(() => {
    showSource({
      scene: "Overlays",
      source,
    });

    if (timeout) {
      setTimeout(() => {
        hideSource({
          scene: "Overlays",
          source,
        });
      }, timeout);
    }
  }, 100); // wait 100 ms i guess
}

export default {
  initialise,
  getWebcamImage,
  switchToScene,
  sourceVisibilityTriggers,
  filterVisibilityTriggers,
  showSource,
  hideSource,
  showHideSource,
  showHideFilter,
  toggleFilter,
  turnOnOverlay,
};