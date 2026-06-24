const axios = require('axios');
const locationRepository = require('../location/location.repository');

const BASE_URL = 'https://data.xotelo.com/api';

const searchHotels = async (cityCode, { limit, minRating } = {}) => {
    // ✅ Lấy location_key từ DB thay vì dùng dict tĩnh
    const locationKey = await locationRepository.getLocationKey(cityCode);
    if (!locationKey) {
        throw new Error(`Thành phố "${cityCode}" chưa được hỗ trợ`);
    }

    const PAGE_SIZE = 20;
    let offset = 0;
    let allHotels = [];
    let totalCount = null;

    do {
        const res = await axios.get(`${BASE_URL}/list`, {
            params: {
                location_key: locationKey,
                limit: PAGE_SIZE,
                offset: offset,
            }
        });

        if (!res.data || !res.data.result) {
            throw new Error('Xotelo API không trả về dữ liệu');
        }

        const result = res.data.result;

        if (totalCount === null) {
            totalCount = result.total_count || 0;
        }

        const list = result.list || [];
        if (list.length === 0) break;

        // Lọc theo min_rating nếu có
        const filtered = minRating
            ? list.filter(h => (h.review_summary?.rating ?? 0) >= minRating)
            : list;

        allHotels = allHotels.concat(filtered);
        offset += PAGE_SIZE;

        console.log(`Đã lấy ${allHotels.length} khách sạn (offset: ${offset}/${totalCount})`);

        // Dừng sớm nếu đã đủ số lượng cần
        if (limit && allHotels.length >= limit) break;

    } while (offset < totalCount);

    // Cắt đúng số lượng nếu có limit
    return limit ? allHotels.slice(0, limit) : allHotels;
};

const getHotelRates = async (hotelKey, checkIn, checkOut) => {
    const res = await axios.get(`${BASE_URL}/rates`, {
        params: {
            hotel_key: hotelKey,
            chk_in:    checkIn,
            chk_out:   checkOut,
        }
    });

    if (!res.data || !res.data.result) {
        return null;
    }

    return res.data.result;
};

module.exports = { searchHotels, getHotelRates };