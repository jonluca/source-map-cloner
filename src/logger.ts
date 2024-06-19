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

const localFormat = combine(ts, colorize(), errors({ stack: true }), print);

export const logger = winston.createLogger({
  level: "debug",
  transports: [
    new winston.transports.Console({
      format: localFormat,
    }),
  ],
});

export default logger;
