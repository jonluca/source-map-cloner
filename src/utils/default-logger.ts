import type { Logger } from "../core/types.js";

/**
 * No-op logger that discards all messages
 */
export const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/**
 * Create a console logger
 */
export const createConsoleLogger = (): Logger => ({
  info: (message: string) => console.log(message),
  warn: (message: string) => console.warn(message),
  error: (message: string) => console.error(message),
  debug: (message: string) => console.debug(message),
});
