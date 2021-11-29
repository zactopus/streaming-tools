import humanToCron from "human-to-cron";
import cron from "node-cron";

const { TIMEZONE } = process.env;

export function schedule(humanReadibleSchedule, callback) {
  return cron.schedule(humanToCron(humanReadibleSchedule), callback, {
    timezone: TIMEZONE,
  });
}
