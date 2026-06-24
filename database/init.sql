-- ========================
-- XeDich Database Schema
-- ========================

CREATE DATABASE IF NOT EXISTS xedich_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE xedich_db;

-- Bảng users
CREATE TABLE IF NOT EXISTS users (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  email       VARCHAR(150) NOT NULL UNIQUE,
  password    VARCHAR(255),
  avatar      VARCHAR(255),
  provider    ENUM('local', 'google') DEFAULT 'local',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS locations (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    city_code       VARCHAR(50) NOT NULL UNIQUE,
    city_name       VARCHAR(100) NOT NULL,
    location_key    VARCHAR(100) NOT NULL UNIQUE,

    is_active       TINYINT(1) DEFAULT 1,

    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    ON UPDATE CURRENT_TIMESTAMP
);

-- Bảng lưu danh sách khách sạn (index từ Xotelo)
CREATE TABLE IF NOT EXISTS hotels (
    id              INT AUTO_INCREMENT PRIMARY KEY,

    hotel_key       VARCHAR(100) NOT NULL UNIQUE,

    location_id     INT NOT NULL,

    name            VARCHAR(200) NOT NULL,
    address         VARCHAR(255),

    lat             DECIMAL(9,6),
    lng             DECIMAL(9,6),

    star_rating     DECIMAL(3,1),

    thumbnail       VARCHAR(500),
    description     VARCHAR(500),

    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_hotels_location
        FOREIGN KEY (location_id)
        REFERENCES locations(id)
        ON DELETE RESTRICT
);

-- ========================================================
-- Bảng cache giá theo TỪNG ĐÊM (thay cho cache theo khoảng check_in/check_out)
-- Lý do đổi: trước đây cache theo cặp (check_in, check_out) nên user đổi
-- ngày là cache miss toàn bộ, dù các đêm overlap nhau đã có giá rồi.
-- Giờ mỗi row = giá 1 đêm (stay_date). Khi cần giá cho 1 khoảng ở (vd 3 đêm),
-- service sẽ cộng giá 3 row stay_date liên tiếp lại.
-- ========================================================
CREATE TABLE IF NOT EXISTS hotel_prices (
    id              INT AUTO_INCREMENT PRIMARY KEY,

    hotel_key       VARCHAR(100) NOT NULL,

    stay_date       DATE NOT NULL,

    price           BIGINT,
    currency        VARCHAR(10) DEFAULT 'USD',
    provider        VARCHAR(50),

    cached_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at      TIMESTAMP,

    UNIQUE KEY uq_hotel_date (
        hotel_key,
        stay_date
    ),

    CONSTRAINT fk_hotel_prices_hotel
        FOREIGN KEY (hotel_key)
        REFERENCES hotels(hotel_key)
        ON DELETE CASCADE
);



-- ========================================================
-- INDEX TỐI ƯU QUERY
-- ========================================================

-- Query khách sạn theo thành phố + rating
CREATE INDEX idx_hotels_location_rating
ON hotels(location_id, star_rating);

CREATE INDEX idx_hotel_prices_stay_date
ON hotel_prices(stay_date);

CREATE INDEX idx_hotel_prices_expire
ON hotel_prices(expires_at);