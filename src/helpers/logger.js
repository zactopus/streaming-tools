const chalk = require("chalk");

const { NODE_ENV } = process.env;
const DEBUG = NODE_ENV !== "production";

const LOG_TYPES_TO_COLOR = {
  log: "yellow",
  info: "white",
  error: "red",
  warn: "orange",
  debug: "blue",
};

function logToConsole(type) {
  // dont log when not in debug mode
  if (type === "debug" && !DEBUG) {
    return () => {};
  }

  const chalkWithType = chalk[LOG_TYPES_TO_COLOR[type]];
  return function (location, message) {
    if (!message) return;

    if (Array.isArray(message)) {
      message = message.join(", ");
    } else if (typeof message === "object") {
      message = JSON.stringify(message);
    }

    // eslint-disable-next-line no-console
    console[type](chalkWithType(`[${location}] ${message}`));
  };
}

const logger = {
  log: logToConsole("log"),
  info: logToConsole("info"),
  error: logToConsole("error"),
  warn: logToConsole("warn"),
  debug: logToConsole("debug"),
};

module.exports = logger;
