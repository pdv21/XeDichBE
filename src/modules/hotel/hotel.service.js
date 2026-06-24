const xoteloService = require('./xotelo.service');
const hotelRepository = require('./hotel.repository');

const searchCache = new Map();
const refreshingKeys = new Set();
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const BATCH_SIZE = 20;

const buildCacheKey = ({ city, checkIn, checkOut, budget, minRating, limit }) =>
    `${city}|${checkIn}|${checkOut}|${budget ?? ''}|${minRating ?? ''}|${limit ?? ''}`;

// ✅ Tách khoảng [checkIn, checkOut) thành danh sách từng đêm, vd 01/07 -> 04/07 = [01/07, 02/07, 03/07]
const getNightsBetween = (checkIn, checkOut) => {
    const nights = [];
    const current = new Date(checkIn);
    const end = new Date(checkOut);
    while (current < end) {
        nights.push(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
    }
    return nights;
};

const nextDay = (dateStr) => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
};

// ✅ Gọi Xotelo cho ĐÚNG 1 đêm (check_in = night, check_out = night + 1) rồi cache lại
const fetchAndCacheNight = async (hotelKey, night) => {
    try {
        const rates = await xoteloService.getHotelRates(hotelKey, night, nextDay(night));
        const bestRate = rates?.rates?.[0];

        if (bestRate) {
            await hotelRepository.cacheNightPrice(hotelKey, night, bestRate.rate, bestRate.name);
            return { price: bestRate.rate, provider: bestRate.name };
        }

        // ✅ Cache null để lần sau không gọi API lại cho đêm này
        await hotelRepository.cacheNightPrice(hotelKey, night, null, null);
        return { price: null, provider: null };
    } catch (error) {
        console.error(`[fetchAndCacheNight] Lỗi ${hotelKey} | ${night}: ${error.message}`);
        return { price: null, provider: null };
    }
};

// ✅ Lấy giá nhiều hotel cho khoảng [checkIn, checkOut) bằng cách cộng giá từng đêm
const batchGetRates = async (hotels, checkIn, checkOut) => {
    const nights = getNightsBetween(checkIn, checkOut);
    console.log(`[batchGetRates] ${hotels.length} khách sạn × ${nights.length} đêm (${checkIn} → ${checkOut})`);

    const hotelKeys = hotels.map(h => h.hotel_key);

    console.log(`[batchGetRates] Query DB lấy giá từng đêm đã cache...`);
    const cachedMap = await hotelRepository.getCachedNights(hotelKeys, nights);

    // nightData: { [hotel_key]: { [date]: { price, provider } } }
    const nightData = {};
    const pendingTasks = []; // { hotelKey, night }

    for (const h of hotels) {
        nightData[h.hotel_key] = {};
        const cachedForHotel = cachedMap[h.hotel_key] || {};
        for (const night of nights) {
            if (night in cachedForHotel) {
                nightData[h.hotel_key][night] = cachedForHotel[night];
            } else {
                pendingTasks.push({ hotelKey: h.hotel_key, night });
            }
        }
    }

    const totalSlots = hotels.length * nights.length;
    console.log(`[batchGetRates] Đã có cache: ${totalSlots - pendingTasks.length}/${totalSlots} đêm, cần gọi API: ${pendingTasks.length} đêm`);

    if (pendingTasks.length > 0) {
        console.log(`[batchGetRates] Gọi Xotelo API cho ${pendingTasks.length} (hotel, đêm) (${Math.ceil(pendingTasks.length / BATCH_SIZE)} batch)...`);
    }

    for (let i = 0; i < pendingTasks.length; i += BATCH_SIZE) {
        const batch = pendingTasks.slice(i, i + BATCH_SIZE);
        console.log(`[batchGetRates] Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(pendingTasks.length / BATCH_SIZE)}`);
        await Promise.all(batch.map(async ({ hotelKey, night }) => {
            nightData[hotelKey][night] = await fetchAndCacheNight(hotelKey, night);
        }));
    }

    // ✅ Cộng giá từng đêm lại thành tổng giá cho cả kỳ ở.
    // Nếu thiếu giá BẤT KỲ đêm nào (không available đêm đó) -> coi như hotel không có giá cho khoảng này.
    const results = hotels.map(h => {
        const perNight = nights.map(n => nightData[h.hotel_key][n]);
        const hasUnavailableNight = perNight.some(np => !np || np.price == null);

        if (hasUnavailableNight) {
            return { ...h, price: null, provider: null, nights: nights.length };
        }

        const total = perNight.reduce((sum, np) => sum + Number(np.price), 0);
        const providers = [...new Set(perNight.map(np => np.provider).filter(Boolean))];

        return { ...h, price: total, provider: providers.join(', '), nights: nights.length };
    });

    console.log(`[batchGetRates] Hoàn thành, tổng ${results.length} khách sạn`);
    return results;
};

const refreshInBackground = async (cacheKey, { city, checkIn, checkOut, budget, minRating, limit }) => {
    if (refreshingKeys.has(cacheKey)) return;
    refreshingKeys.add(cacheKey);

    console.log(`[SearchCache] Background refresh bắt đầu: ${cacheKey}`);
    try {
        let hotels = await hotelRepository.findByCity(city);
        if (!hotels || hotels.length === 0) return;

        if (minRating) hotels = hotels.filter(h => (h.star_rating ?? 0) >= minRating);
        if (limit) hotels = hotels.slice(0, limit);

        const withPrices = await batchGetRates(hotels, checkIn, checkOut);
        const filtered = withPrices
            .filter(h => h.price !== null)  // ✅ chỉ giữ hotel có giá trong response
            .filter(h => !budget || h.price <= budget)
            .sort((a, b) => a.price - b.price);

        searchCache.set(cacheKey, { data: filtered, createdAt: Date.now() });
        console.log(`[SearchCache] Background refresh xong: ${cacheKey} — ${filtered.length} khách sạn`);
    } catch (err) {
        console.error(`[SearchCache] Background refresh lỗi: ${cacheKey}`, err.message);
    } finally {
        refreshingKeys.delete(cacheKey);
    }
};

const searchHotelsWithPrice = async ({ city, checkIn, checkOut, budget, limit, minRating, page, pageSize }) => {
    const cacheKey = buildCacheKey({ city, checkIn, checkOut, budget, minRating, limit });
    console.log(`[SearchCache] Request: ${cacheKey} | page=${page} pageSize=${pageSize}`);

    const cached = searchCache.get(cacheKey);

    if (cached) {
        const age = Date.now() - cached.createdAt;
        if (age < CACHE_TTL_MS) {
            console.log(`[SearchCache] HIT: ${cacheKey} — ${cached.data.length} khách sạn, tuổi cache: ${Math.round(age / 1000)}s`);
        } else {
            console.log(`[SearchCache] STALE: ${cacheKey} — cache hết hạn, refresh ngầm`);
            refreshInBackground(cacheKey, { city, checkIn, checkOut, budget, minRating, limit });
        }

        const { data: allData } = cached;
        const total = allData.length;
        const start = (page - 1) * pageSize;
        return {
            data: allData.slice(start, start + pageSize),
            pagination: { total, page, page_size: pageSize, total_pages: Math.ceil(total / pageSize) }
        };
    }

    console.log(`[SearchCache] MISS: ${cacheKey} — bắt đầu xử lý`);
    let hotels = await hotelRepository.findByCity(city);
    console.log(`[SearchCache] Lấy từ DB: ${hotels?.length ?? 0} khách sạn`);

    if (!hotels || hotels.length === 0) {
        throw new Error('Không tìm thấy khách sạn nào, vui lòng thử lại sau');
    }

    if (minRating) {
        hotels = hotels.filter(h => (h.star_rating ?? 0) >= minRating);
        console.log(`[SearchCache] Sau filter rating >= ${minRating}: ${hotels.length} khách sạn`);
    }

    if (limit) {
        hotels = hotels.slice(0, limit);
        console.log(`[SearchCache] Sau giới hạn limit=${limit}: ${hotels.length} khách sạn`);
    }

    const withPrices = await batchGetRates(hotels, checkIn, checkOut);

    const filtered = withPrices
        .filter(h => h.price !== null)  // ✅ chỉ giữ hotel có giá trong response
        .filter(h => !budget || h.price <= budget)
        .sort((a, b) => a.price - b.price);

    console.log(`[SearchCache] Sau filter giá: ${filtered.length} khách sạn có giá`);
    searchCache.set(cacheKey, { data: filtered, createdAt: Date.now() });
    console.log(`[SearchCache] Đã lưu vào memory cache`);

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    return {
        data: filtered.slice(start, start + pageSize),
        pagination: { total, page, page_size: pageSize, total_pages: Math.ceil(total / pageSize) }
    };
};

// ✅ Chi tiết giá 1 hotel cho khoảng [checkIn, checkOut) — trả breakdown từng đêm + tổng tiền
const getHotelDetail = async (hotelKey, checkIn, checkOut) => {
    console.log(`[getHotelDetail] ${hotelKey} | ${checkIn} → ${checkOut}`);

    const nights = getNightsBetween(checkIn, checkOut);
    const cachedMap = await hotelRepository.getCachedNights([hotelKey], nights);
    const cachedForHotel = cachedMap[hotelKey] || {};

    const nightDetails = [];
    for (const night of nights) {
        if (night in cachedForHotel) {
            nightDetails.push({ date: night, ...cachedForHotel[night], from_cache: true });
        } else {
            console.log(`[getHotelDetail] Đêm ${night} chưa có cache, gọi Xotelo API...`);
            const result = await fetchAndCacheNight(hotelKey, night);
            nightDetails.push({ date: night, ...result, from_cache: false });
        }
    }

    const hasUnavailableNight = nightDetails.some(n => n.price == null);
    const totalPrice = hasUnavailableNight
        ? null
        : nightDetails.reduce((sum, n) => sum + Number(n.price), 0);

    return {
        hotel_key: hotelKey,
        check_in: checkIn,
        check_out: checkOut,
        total_price: totalPrice,
        nights: nightDetails,
    };
};

module.exports = { searchHotelsWithPrice, getHotelDetail };