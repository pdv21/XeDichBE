const cron = require('node-cron');
const xoteloService = require('./xotelo.service');
const hotelRepository = require('./hotel.repository');
const locationRepository = require('../location/location.repository'); 
const { scheduleRateCacheJobs } = require('./hotel.rate.queue');

const MIN_RATING = 3;

const syncHotelsForCity = async (location) => {
    const { city_code, id: locationId } = location;
    console.log('[DEBUG] location object:', location);
    console.log(`[HotelSync] Bắt đầu sync: ${city_code}`);
    try {
        const hotels = await xoteloService.searchHotels(city_code);

        if (!hotels || hotels.length === 0) {
            console.warn(`[HotelSync] Không có dữ liệu cho: ${city_code}`);
            return { city: city_code, success: false, count: 0 };
        }

        const filtered = hotels.filter(h => (h.review_summary?.rating ?? 0) >= MIN_RATING);
        console.log(`[HotelSync] ${city_code}: ${filtered.length}/${hotels.length} khách sạn có rating >= ${MIN_RATING}`);
        console.log('[DEBUG] Sample hotel:', JSON.stringify(filtered[0], null, 2));
        let successCount = 0;
        for (const h of filtered) {
            const saved = await hotelRepository.upsertHotel({
                hotel_key:   h.key || null,
                name:        h.name || null,
                location_id: locationId, // ✅ dùng location_id thay vì city
                address:     null,
                lat:         h.geo?.latitude ?? null,
                lng:         h.geo?.longitude ?? null,
                star_rating: h.review_summary?.rating ?? null,
                thumbnail:   h.image || null,
                description: h.mentions?.join(', ') || null,
            });
            if (saved) successCount++;
        }

        console.log(`[HotelSync] Hoàn thành ${city_code}: ${successCount}/${filtered.length} khách sạn`);
        return { city: city_code, success: true, count: successCount };
    } catch (error) {
        console.error(`[HotelSync] Lỗi khi sync ${city_code}:`, error.message);
        return { city: city_code, success: false, count: 0, error: error.message };
    }
};

const syncAllCities = async () => {
    const locations = await locationRepository.getAllLocations(); // ✅ dùng đúng biến

    console.log(`[HotelSync] Bắt đầu sync ${locations.length} thành phố lúc ${new Date().toISOString()}`);

    const results = [];
    for (const location of locations) {
        const result = await syncHotelsForCity(location); // ✅ truyền cả object location
        results.push(result);
    }

    const succeeded = results.filter(r => r.success).length;
    const failed    = results.filter(r => !r.success);

    console.log(`[HotelSync] Kết quả: ${succeeded}/${locations.length} thành phố thành công`);
    if (failed.length > 0) {
        console.warn(`[HotelSync] Thất bại:`, failed.map(r => r.city).join(', '));
    }
};

// Chạy lúc 0h: sync hotel trước, sau đó schedule rate cache
cron.schedule('0 0 * * *', async () => {
    console.log('[HotelSync] Cron 0h bắt đầu...');

    await syncAllCities();

    console.log('[HotelSync] Sync xong, bắt đầu schedule rate cache...');
    await scheduleRateCacheJobs();

}, { timezone: 'Asia/Ho_Chi_Minh' });

console.log('[HotelSync] Cron job đã được đăng ký — chạy lúc 0h mỗi ngày (Asia/Ho_Chi_Minh)');

module.exports = { syncAllCities, syncHotelsForCity };