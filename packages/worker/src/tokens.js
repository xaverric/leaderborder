import { base64urlEncode, hex, utf8 } from "./encoding.js";

const TOKEN_PATTERN = /^lb_[A-Za-z0-9_-]{43}$/;

export const createDeviceToken = () => `lb_${base64urlEncode(crypto.getRandomValues(new Uint8Array(32)))}`;

export const hashToken = async (token) => hex(await crypto.subtle.digest("SHA-256", utf8(token)));

export const isDeviceTokenFormat = (token) => typeof token === "string" && TOKEN_PATTERN.test(token);
