import { CookieJar } from "tough-cookie";
import type { AgentOptions } from "http";
import https from "https";
import * as http from "node:http";
import got from "got";
export const ciphers = [
  "TLS_AES_128_GCM_SHA256",
  "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
  "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
  "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
  "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
  "TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256",
  "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
  "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA",
  "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
  "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA",
  "TLS_RSA_WITH_AES_128_GCM_SHA256",
  "TLS_RSA_WITH_AES_256_GCM_SHA384",
  "TLS_RSA_WITH_AES_128_CBC_SHA",
  "TLS_RSA_WITH_AES_256_CBC_SHA",
  "SSL_RSA_WITH_3DES_EDE_CBC_SHA",
].join(":");

export const cookieJar = new CookieJar();
const options: AgentOptions = {
  keepAlive: true,
  family: 4, // default to ipv4
} as const;

const httpsAgent = new https.Agent({
  ...options,
  rejectUnauthorized: false,
  ciphers,
});

const httpAgent = new http.Agent(options);

export const agent = {
  http: httpAgent,
  https: httpsAgent,
};
export const gotClient = got.extend({
  agent,
  http2: true,
  cookieJar,
});
