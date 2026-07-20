const db = require('../../shared/config/database');

// Dùng nội bộ bởi các sync job (hotel/place) và các repository khác — không có
// route/controller vì không có API public nào thao tác trực tiếp trên locations.

const getAllLocations = async () => {
  const [rows] = await db.execute(
    `SELECT id, city_code, city_name, country_code, latitude, longitude, crawl_radius_m
     FROM locations WHERE is_active = 1`
  );
  return rows;
};

const findByCityName = async (countryCode, cityName) => {
  const [rows] = await db.execute(
    `SELECT id, city_code, city_name, country_code FROM locations
     WHERE country_code = ? AND LOWER(city_name) = LOWER(?) AND is_active = 1
     LIMIT 1`,
    [countryCode, cityName]
  );
  return rows[0] ?? null;
};

const findByCityCode = async (cityCode) => {
  const [rows] = await db.execute(
    `SELECT id, city_code, city_name, country_code FROM locations
     WHERE city_code = ? AND is_active = 1
     LIMIT 1`,
    [cityCode]
  );
  return rows[0] ?? null;
};

module.exports = { getAllLocations, findByCityName, findByCityCode };
