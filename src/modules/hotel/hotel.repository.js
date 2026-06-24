const db = require('../../shared/config/database');

// ✅ Dùng JOIN với bảng locations để tìm hotel theo city_code
const findByCity = async (cityCode) => {
    const [rows] = await db.execute(
        `SELECT h.* FROM hotels h
         JOIN locations l ON h.location_id = l.id
         WHERE l.city_code = ?
         ORDER BY h.star_rating DESC`,
        [cityCode]
    );
    return rows;
};

// ✅ Upsert hotel dùng location_id thay vì city
const upsertHotel = async (hotel) => {
    const [result] = await db.execute(
        `INSERT INTO hotels (
            hotel_key,
            name,
            location_id,
            address,
            lat,
            lng,
            star_rating,
            thumbnail,
            description
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            name         = VALUES(name),
            location_id  = VALUES(location_id),
            address      = VALUES(address),
            lat          = VALUES(lat),
            lng          = VALUES(lng),
            star_rating  = VALUES(star_rating),
            thumbnail    = VALUES(thumbnail),
            description  = VALUES(description)`,
        [
            hotel.hotel_key,
            hotel.name,
            hotel.location_id,
            hotel.address,
            hotel.lat,
            hotel.lng,
            hotel.star_rating,
            hotel.thumbnail,
            hotel.description,
        ]
    );

    return result.affectedRows > 0;
};

// ✅ Lấy giá 1 đêm đã cache cho 1 hotel (dùng để check "đã cache chưa" trong queue worker)
// Nếu expires_at đã qua: coi như chưa cache (cho phép thử lại API sau 12h)
// Nếu price IS NULL nhưng còn hạn: vẫn coi là đã cache (tránh gọi lại API vô ích)
const getCachedNightPrice = async (hotelKey, stayDate) => {
    const [rows] = await db.execute(
        `SELECT * FROM hotel_prices
         WHERE hotel_key = ? AND stay_date = ?
           AND expires_at > NOW()
         LIMIT 1`,
        [hotelKey, stayDate]
    );
    return rows[0];
};

// ✅ Lấy giá nhiều đêm cho nhiều hotel cùng lúc (dùng khi search list khách sạn)
// Trả về dạng: { [hotel_key]: { [stay_date]: { price, provider } } }
const getCachedNights = async (hotelKeys, stayDates) => {
    if (!hotelKeys || hotelKeys.length === 0 || !stayDates || stayDates.length === 0) return {};

    const keyPlaceholders  = hotelKeys.map(() => '?').join(', ');
    const datePlaceholders = stayDates.map(() => '?').join(', ');

    const [rows] = await db.execute(
        `SELECT hotel_key, stay_date, price, provider FROM hotel_prices
         WHERE hotel_key IN (${keyPlaceholders})
           AND stay_date IN (${datePlaceholders})
           AND expires_at > NOW()`,
        [...hotelKeys, ...stayDates]
    );

    return rows.reduce((acc, row) => {
        // mysql2 trả DATE về dạng Date object -> format lại thành 'YYYY-MM-DD' để khớp key
        const dateStr = row.stay_date instanceof Date
            ? row.stay_date.toISOString().split('T')[0]
            : row.stay_date;

        if (!acc[row.hotel_key]) acc[row.hotel_key] = {};
        acc[row.hotel_key][dateStr] = { price: row.price, provider: row.provider };
        return acc;
    }, {});
};

// ✅ Lưu/cập nhật giá CHO 1 ĐÊM của 1 hotel
const cacheNightPrice = async (hotelKey, stayDate, price, provider) => {
    const [result] = await db.execute(
        `INSERT INTO hotel_prices (hotel_key, stay_date, price, provider, expires_at)
         VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 12 HOUR))
         ON DUPLICATE KEY UPDATE
         price      = VALUES(price),
         provider   = VALUES(provider),
         expires_at = VALUES(expires_at),
         cached_at  = CURRENT_TIMESTAMP`,
        [hotelKey, stayDate, price ?? null, provider ?? null]
    );
    return result.affectedRows > 0;
};

module.exports = {
    findByCity,
    upsertHotel,
    getCachedNightPrice,
    getCachedNights,
    cacheNightPrice,
};