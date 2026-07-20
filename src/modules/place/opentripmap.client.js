const axios = require("axios");
const https = require("https");

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 10,
  maxFreeSockets: 5,
});

// OpenTripMap: key truyền qua query param `apikey` (không phải header).
// Free plan giới hạn ~5000 request/ngày — sync job phải tiết kiệm call
// (chỉ gọi detail cho điểm nổi tiếng, xem place.sync.job.js).
const otmClient = axios.create({
  baseURL: process.env.OPENTRIPMAP_BASE_URL || "https://api.opentripmap.com/0.1/en",
  timeout: 15_000,
  httpsAgent,
  params: { apikey: process.env.OPENTRIPMAP_API_KEY },
});

// Retry lỗi mạng/5xx/429 với backoff — không retry 4xx khác (input sai)
const withRetry = async (fn, { maxAttempts = 3, baseDelayMs = 1000 } = {}) => {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      if (status && status >= 400 && status < 500 && status !== 429) throw err;

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastErr;
};

module.exports = { client: otmClient, withRetry };

