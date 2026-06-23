const axios        = require('axios');
const LOCATION_KEYS = require('../../shared/config/location_key');

const BASE_URL = 'https://data.xotelo.com/api';

const searchHotels = async (city) => {
    // Đổi tên thành phố sang location_key
    const locationKey = LOCATION_KEYS[city];
    if (!locationKey) {
        throw new Error(`Thành phố "${city}" chưa được hỗ trợ`);
    }

    const res = await axios.get(`${BASE_URL}/list`, {
        params: {
            location_key: locationKey,  // ← đổi từ location sang location_key
            limit: 20,
        }
    });

    console.log('Xotelo response:', JSON.stringify(res.data, null, 2));

    if (!res.data || !res.data.result) {
        throw new Error('Xotelo API không trả về dữ liệu');
    }

    // Xotelo trả về result.list thay vì result trực tiếp
    return res.data.result.list || [];
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