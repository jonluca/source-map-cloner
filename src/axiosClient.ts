import { HttpCookieAgent, HttpsCookieAgent } from "http-cookie-agent/http";
import { CookieJar } from "tough-cookie";
import type { AxiosRequestConfig } from "axios";
import axios from "axios";

export const jar = new CookieJar(undefined, {
  allowSpecialUseDomain: true,
  looseMode: true,
  rejectPublicSuffixes: false,
});
export function requestInterceptor(
  config: AxiosRequestConfig
): AxiosRequestConfig {
  if (!config.jar) {
    return config;
  }

  config.httpAgent = new HttpCookieAgent({
    cookies: { jar: config.jar },
    keepAlive: true,
  });
  config.httpsAgent = new HttpsCookieAgent({
    cookies: { jar: config.jar },
    keepAlive: true,
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

const client = axios.create({ jar });
client.interceptors.request.use(requestInterceptor);
export const axiosClient = client;
