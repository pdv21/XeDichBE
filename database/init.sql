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

-- Bảng lưu danh sách khách sạn (index từ Xotelo)
CREATE TABLE IF NOT EXISTS hotels (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  hotel_key       VARCHAR(100) NOT NULL UNIQUE,  -- ID của Xotelo
  name            VARCHAR(200) NOT NULL,
  city            VARCHAR(100) NOT NULL,
  address         VARCHAR(255),
  lat             DECIMAL(9,6),
  lng             DECIMAL(9,6),
  star_rating     TINYINT,
  thumbnail       VARCHAR(500),
  description     VARCHAR(500),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Bảng cache giá theo ngày (tránh gọi API liên tục)
CREATE TABLE IF NOT EXISTS hotel_prices (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  hotel_key       VARCHAR(100) NOT NULL,
  check_in        DATE NOT NULL,
  check_out       DATE NOT NULL,
  price           BIGINT,           -- giá VND
  currency        VARCHAR(10) DEFAULT 'VND',
  provider        VARCHAR(50),      -- booking.com, agoda...
  cached_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at      TIMESTAMP,        -- hết hạn cache sau 6 tiếng
  UNIQUE KEY uq_hotel_dates (hotel_key, check_in, check_out)
);