const db = require('../../shared/config/database');

const findByCity = async (city) => {
    const [rows] = await db.execute(
        'SELECT * FROM hotels WHERE city = ? ORDER BY star_rating DESC',
        [city]
    );
    return rows;
}

const upsetHotel = async (hotel) => {
    const [result] = await db.execute(
        `INSERT INTO hotels (hotel_key, name, city, star_rating, address, description)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         city = VALUES(city),
         star_rating = VALUES(star_rating),
         address = VALUES(address),
         description = VALUES(description)`,
        [hotel.hotel_key ?? null,
         hotel.name ?? null, 
         hotel.city ?? null, 
         hotel.star_rating ?? null,
         hotel.address ?? null, 
         hotel.description ?? null]
    );
    return result.affectedRows > 0;
}

const getCachedPrice = async (hotelKey, checkIn, checkOut) => {
    const [rows] = await db.execute(
        'SELECT * FROM hotel_prices WHERE hotel_key = ? AND check_in = ? AND check_out = ? AND expires_at > NOW() LIMIT 1',
        [hotelKey, checkIn, checkOut]
    );
    return rows[0];
}

const cachePrice = async (hotelKey, checkIn, checkOut, price) => {
    const [result] = await db.execute(
        `INSERT INTO hotel_prices (hotel_key, check_in, check_out, price, expires_at)
         VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 12 HOUR))
         ON DUPLICATE KEY UPDATE
         price = VALUES(price),
         provider   = VALUES(provider),
         expires_at = VALUES(expires_at),
         cached_at  = CURRENT_TIMESTAMP`,
        [hotelKey, checkIn, checkOut, price]
    );
    return result.affectedRows > 0;
}

module.exports = { findByCity, upsetHotel, getCachedPrice, cachePrice };