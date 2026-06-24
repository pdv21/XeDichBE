const { Queue, Worker } = require('bullmq');
const redis = require('../../shared/config/redis');
const xoteloService = require('./xotelo.service');
const hotelRepository = require('./hotel.repository');
const locationRepository = require('../location/location.repository'); // ✅ đã thêm

const QUEUE_NAME = 'hotel-rate-cache';
const BATCH_SIZE = 10;

// Cấu hình các tier
const TIERS = [
    { from: 1,  to: 15,  priority: 1, label: 'near' },   // hàng ngày
    { from: 16, to: 45,  priority: 2, label: 'mid' },    // 2 ngày/lần
    { from: 46, to: 180, priority: 3, label: 'far' },    // 3 ngày/lần
];

// Khởi tạo queue
const rateQueue = new Queue(QUEUE_NAME, { connection: redis });

// Đếm progress
let completedCount = 0;
let totalJobs = 0;

// Lấy tổng jobs hiện có trong queue khi khởi động
rateQueue.getJobCounts('waiting', 'active', 'delayed').then(counts => {
    totalJobs = (counts.waiting || 0) + (counts.active || 0) + (counts.delayed || 0);
    if (totalJobs > 0) {
        console.log(`[RateQueue] Phát hiện ${totalJobs} jobs đang chờ trong queue`);
    }
});

// Kiểm tra ngày hôm nay có phải ngày chạy của tier không
const shouldRunToday = (tier) => {
    if (tier.label === 'near') return true;

    const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);

    if (tier.label === 'mid') return dayOfYear % 2 === 0;
    if (tier.label === 'far') return dayOfYear % 3 === 0;

    return false;
};

// ✅ Sinh danh sách ĐÊM (stay_date) cần cache cho tier — mỗi job ứng với 1 đêm
const generateNightsForTier = (tier) => {
    const nights = [];
    for (let i = tier.from; i <= tier.to; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        nights.push(d.toISOString().split('T')[0]);
    }
    return nights;
};

const nextDay = (dateStr) => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
};

// Thêm jobs vào queue theo tier (chạy hàng đêm theo lịch)
const scheduleRateCacheJobs = async () => {
    const locations = await locationRepository.getAllLocations(); // ✅ dùng đúng biến
    const cities = locations.map(x => x.city_code);
    let addedJobs = 0;

    console.log(`[RateQueue] Bắt đầu schedule lúc ${new Date().toISOString()}`);

    for (const tier of TIERS) {
        if (!shouldRunToday(tier)) {
            console.log(`[RateQueue] Tier "${tier.label}" (${tier.from}-${tier.to} ngày) — bỏ qua hôm nay`);
            continue;
        }

        const nights = generateNightsForTier(tier);
        console.log(`[RateQueue] Tier "${tier.label}": ${cities.length} thành phố × ${nights.length} đêm = ${cities.length * nights.length} jobs`);

        for (const city of cities) {
            for (const night of nights) {
                await rateQueue.add(
                    'cache-rate',
                    { city, night, tier: tier.label },
                    {
                        jobId: `${city}-${night}`,
                        priority: tier.priority,
                        attempts: 3,
                        backoff: { type: 'exponential', delay: 5000 },
                        removeOnComplete: true,
                        removeOnFail: false,
                    }
                );
                addedJobs++;
            }
        }
    }

    // Reset counter khi schedule lại
    completedCount = 0;
    totalJobs = addedJobs;
    console.log(`[RateQueue] Tổng ${addedJobs} jobs đã được thêm vào queue`);
};

// Worker xử lý từng job — mỗi job cache giá 1 đêm cho toàn bộ hotel của 1 thành phố
const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
        const { city, night, tier } = job.data;
        console.log(`[RateQueue] Xử lý [${tier ?? 'unknown'}]: ${city} | đêm ${night}`);

        const allHotels = await hotelRepository.findByCity(city);
        if (!allHotels || allHotels.length === 0) return;

        // Tier far chỉ lấy top 50% hotel theo rating
        const hotels = tier === 'far'
            ? allHotels.slice(0, Math.ceil(allHotels.length * 0.5))
            : allHotels;

        let cachedCount = 0;
        let skippedCount = 0;

        for (let i = 0; i < hotels.length; i += BATCH_SIZE) {
            const batch = hotels.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (h) => {
                try {
                    const existing = await hotelRepository.getCachedNightPrice(h.hotel_key, night);
                    if (existing) {
                        skippedCount++;
                        return;
                    }

                    const rates = await xoteloService.getHotelRates(h.hotel_key, night, nextDay(night));
                    const bestRate = rates?.rates?.[0];

                    if (bestRate) {
                        await hotelRepository.cacheNightPrice(h.hotel_key, night, bestRate.rate, bestRate.name);
                        cachedCount++;
                    } else {
                        await hotelRepository.cacheNightPrice(h.hotel_key, night, null, null);
                    }
                } catch (err) {
                    console.error(`[RateQueue] Lỗi ${h.hotel_key}:`, err.message);
                }
            }));
        }

        console.log(`[RateQueue] Xong [${tier ?? 'unknown'}]: ${city} | đêm ${night} — cached ${cachedCount}, skipped ${skippedCount}/${hotels.length}`);
    },
    {
        connection: redis,
        concurrency: 3,
        limiter: {
            max: 3,
            duration: 60 * 1000,
        }
    }
);

worker.on('completed', (job) => {
    completedCount++;
    const progress = totalJobs > 0 ? `${completedCount}/${totalJobs}` : `${completedCount}`;
    const percent  = totalJobs > 0 ? ` (${Math.round(completedCount / totalJobs * 100)}%)` : '';
    console.log(`[RateQueue] ✅ [${progress}${percent}] ${job.data.tier} | ${job.data.city} | đêm ${job.data.night}`);
});

worker.on('failed', (job, err) => {
    const progress = totalJobs > 0 ? `${completedCount}/${totalJobs}` : `${completedCount}`;
    console.error(`[RateQueue] ❌ [${progress}] ${job.data.tier} | ${job.data.city} | đêm ${job.data.night} —`, err.message);
});

console.log('[RateQueue] Worker đã sẵn sàng');

module.exports = { scheduleRateCacheJobs, rateQueue };