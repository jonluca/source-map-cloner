import "axios";
import type { CookieJar } from "tough-cookie";

declare module "axios" {
  interface AxiosRequestConfig {
    jar?: CookieJar;
  }
  interface AxiosInterceptorManager {
    handlers: Array<{
      fulfilled: (...args: unknown[]) => unknown;
      rejected: (...args: unknown[]) => unknown;
      runWhen: unknown;
      synchronous: unknown;
    }>;
  }
}
