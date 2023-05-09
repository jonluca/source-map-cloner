import type { LeveledLogMethod } from "winston";
import winston from "winston";
import { MESSAGE } from "triple-beam";
const { combine, timestamp, printf, colorize, errors, splat } = winston.format;
const ts = timestamp({
  format: "YYYY-MM-DD HH:mm:ss",
});
export const print = printf((info) => {
  let message = info.message || info[MESSAGE] || info.code;
  if (typeof message === "object") {
    message = JSON.stringify(message);
  }
  return (
    `[${info.timestamp}] [${info.level}] - ${message}` +
    (info.splat !== undefined ? `${info.splat}` : " ") +
    (info.stack !== undefined ? `${info.stack}` : " ")
  );
});

const localFormat = combine(ts, colorize(), splat(), errors({ stack: true }), print);

export const logger = winston.createLogger({
  level: "debug",
  transports: [
    new winston.transports.Console({
      format: localFormat,
    }),
  ],
});

const oldError = logger.error;
logger.error = ((...args) => {
  const err = args[0] || {};
  if (!(err instanceof Error)) {
    const stack = new Error().stack;
    if (typeof err === "string") {
      args[0] = { message: err, stack };
    } else {
      err.stack = stack;
    }
  }

  if (!err.message) {
    err.message = "Unknown error";
  }
  args[0] = err;

  return oldError(...args);
}) as LeveledLogMethod;

export default logger;
