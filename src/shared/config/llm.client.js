const axios = require("axios");
const https = require("https");

// LLM client trừu tượng — hiện dùng Google Gemini (free tier 1500 req/ngày).
// Đổi provider chỉ cần sửa file này + env, các module gọi generateJSON không đổi.
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MODEL = process.env.LLM_MODEL || "gemini-flash-latest";

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 5 });

const client = axios.create({
  baseURL: GEMINI_BASE,
  timeout: 60_000, // LLM có thể chậm — 60s rồi bỏ cuộc (AI là best-effort)
  httpsAgent,
  headers: { "x-goog-api-key": process.env.GEMINI_KEY || "" },
});

const withRetry = async (fn, { maxAttempts = 2, baseDelayMs = 2000 } = {}) => {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      // retry lỗi mạng/5xx/429 (free tier hay dính rate limit theo phút)
      if (status && status >= 400 && status < 500 && status !== 429) throw err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
      }
    }
  }
  throw lastErr;
};

// Gửi prompt, nhận về object JSON đã parse.
// responseMimeType application/json ép Gemini chỉ trả JSON hợp lệ;
// thinkingBudget 0 tắt "suy nghĩ" — task viết mô tả không cần, đỡ chậm.
const generateJSON = async (prompt) => {
  const res = await withRetry(() =>
    client.post(`/models/${MODEL}:generateContent`, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 4096,
      },
    })
  );

  const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("LLM không trả về nội dung");
  return JSON.parse(text);
};

module.exports = { generateJSON };
