const axios = require("axios");
const https = require("https");
const { getOrSet } = require("../../shared/utils/cache");

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

const client = axios.create({
  baseURL: "https://ignav.com/api",
  timeout: 30_000, // Ignav chậm (search nhiều hãng), 30s
  httpsAgent,
  headers: {
    "X-Api-Key": process.env.IGNAV_API_KEY,
    "Content-Type": "application/json",
  },
});

const FLIGHT_CACHE_TTL_MS = 10 * 60 * 1000; // giá vé đổi chậm hơn giá phòng

// Tìm chuyến bay một chiều, trả về toàn bộ itineraries
const searchOneWay = async ({ origin, destination, departureDate, adults = 1 }) => {
  const key = `flight:${origin}:${destination}:${departureDate}:${adults}`;
  return getOrSet(key, FLIGHT_CACHE_TTL_MS, async () => {
    const { data } = await client.post("/fares/one-way", {
      origin,
      destination,
      departure_date: departureDate,
      adults,
    });
    return data;
  });
};

// Giá rẻ nhất 1 chiều (USD/người) — dùng cho ước tính budget.
// Trả null nếu không có chuyến (không throw — budget coi vé bay là optional).
const getCheapestOneWayPrice = async ({ origin, destination, departureDate, adults = 1 }) => {
  try {
    const data = await searchOneWay({ origin, destination, departureDate, adults });
    const prices = (data?.itineraries ?? [])
      .map((it) => it?.price?.amount)
      .filter((p) => typeof p === "number" && p > 0);
    return prices.length > 0 ? Math.min(...prices) : null;
  } catch (err) {
    console.warn(`[FlightService] Lỗi tìm vé ${origin}→${destination} ${departureDate}:`, err.message);
    return null;
  }
};

module.exports = { searchOneWay, getCheapestOneWayPrice };
