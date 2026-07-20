const axios = require("axios");
const https = require("https");

// Keep-alive để tái dùng TCP/TLS connection giữa các request tới LiteAPI,
// tránh handshake lại mỗi lần (đỡ tốn thời gian + tài nguyên khi gọi nhiều).
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 50,
  maxFreeSockets: 10,
});

const literapiClient = axios.create({
  baseURL: process.env.LITEAPI_BASE_URL || "https://api.liteapi.travel/v3.0",
  timeout: 15_000, // tránh request treo vô thời hạn nếu LiteAPI chậm/treo
  httpsAgent,
  headers: {
    accept: "application/json",
    "content-type": "application/json",
    "X-API-Key": process.env.LITEAPI_API_KEY,
  },
});

// Retry tối đa 3 lần, backoff 500ms/1s/2s — chỉ retry lỗi mạng/5xx,
// không retry 4xx vì đó là lỗi input (retry cũng không giúp gì).
const withRetry = async (fn, { maxAttempts = 3, baseDelayMs = 500 } = {}) => {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      if (status && status >= 400 && status < 500) throw err;

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastErr;
};

module.exports = { client: literapiClient, withRetry };
