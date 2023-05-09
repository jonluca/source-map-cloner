import { HttpCookieAgent, HttpsCookieAgent } from "http-cookie-agent/http";
import { CookieJar } from "tough-cookie";
import type { InternalAxiosRequestConfig } from "axios";
import axios from "axios";

export const jar = new CookieJar(undefined, {
  allowSpecialUseDomain: true,
  looseMode: true,
  rejectPublicSuffixes: false,
});
const timeout = 60 * 15 * 1000; // 15 minutes

export function requestInterceptor(
  config: InternalAxiosRequestConfig
): InternalAxiosRequestConfig {
  if (!config.jar) {
    return config;
  }

  config.httpAgent = new HttpCookieAgent({
    cookies: { jar: config.jar },
    keepAlive: true,
    timeout,
  });
  config.httpsAgent = new HttpsCookieAgent({
    cookies: { jar: config.jar },
    keepAlive: true,
    timeout,
    ciphers: [
      "TLS_AES_128_GCM_SHA256",
      "TLS_AES_256_GCM_SHA384",
      "TLS_CHACHA20_POLY1305_SHA256",
      "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
      "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
      "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
      "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
      "TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256",
      "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
      "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA",
      "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA",
      "TLS_RSA_WITH_AES_128_GCM_SHA256",
      "TLS_RSA_WITH_AES_256_GCM_SHA384",
      "TLS_RSA_WITH_AES_128_CBC_SHA",
      "TLS_RSA_WITH_AES_256_CBC_SHA",
      "SSL_RSA_WITH_3DES_EDE_CBC_SHA",
    ].join(":"),
  });

  return config;
}

const client = axios.create({
  jar,
  headers: {
    "accept-language": "en",
    "cache-control": "max-age=0",
    "sec-ch-ua":
      '"Chromium";v="110", "Not A(Brand";v="24", "Google Chrome";v="110"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
  },
  validateStatus: () => true,
  timeout, // 15 minutes
});
client.interceptors.request.use(requestInterceptor);
export const axiosClient = client;
