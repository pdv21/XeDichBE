SET time_zone = '+07:00';

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

-- Danh sách thành phố được hỗ trợ tìm khách sạn (LiteAPI cần đúng cityName này).
-- latitude/longitude là toạ độ trung tâm thành phố — dùng làm tâm bán kính crawl
-- địa điểm từ OpenTripMap (place.sync.job.js); crawl_radius_m tuỳ theo diện tích
-- (đảo lớn như Phú Quốc cần bán kính rộng hơn nội đô).
CREATE TABLE IF NOT EXISTS locations (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  city_code      VARCHAR(50)  NOT NULL UNIQUE,
  city_name      VARCHAR(150) NOT NULL,
  country_code   VARCHAR(5)   NOT NULL DEFAULT 'VN',
  latitude       DECIMAL(9,6),
  longitude      DECIMAL(9,6),
  crawl_radius_m INT DEFAULT 10000,
  -- Sân bay gần nhất (IATA) — dùng ước tính vé bay trong budget; thành phố
  -- không có sân bay riêng trỏ về sân bay gần nhất (vd Hội An → DAD)
  airport_code   VARCHAR(5) NULL,
  is_active      TINYINT(1)   DEFAULT 1,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ========================================================
-- Cache dữ liệu TĨNH khách sạn từ LiteAPI (tên, địa chỉ, ảnh, mô tả ngắn,...).
-- Đồng bộ 1 lần/tuần bằng cron (hotel.sync.job.js) — dữ liệu này ít đổi nên
-- không cần đồng bộ thường xuyên. Giá phòng KHÔNG lưu ở đây — giá luôn gọi
-- live LiteAPI (đã có cache 5 phút riêng ở tầng repository) vì giá đổi liên tục
-- theo ngày/số khách, cache lâu dễ hiển thị sai giá.
-- ========================================================
CREATE TABLE IF NOT EXISTS hotels (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  hotel_id       VARCHAR(50)  NOT NULL UNIQUE,   -- id của LiteAPI, vd 'lp65555753'
  location_id    INT NOT NULL,

  name           VARCHAR(255) NOT NULL,
  address        VARCHAR(500),
  country_code   VARCHAR(5),
  city_name      VARCHAR(150),

  latitude       DECIMAL(9,6),
  longitude      DECIMAL(9,6),

  star_rating    DECIMAL(3,1),
  review_score   DECIMAL(4,2),
  review_count   INT,

  currency       VARCHAR(10),
  chain          VARCHAR(150),
  main_photo     VARCHAR(500),
  thumbnail      VARCHAR(500),
  facility_ids   JSON,

  last_synced_at TIMESTAMP NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_hotels_location
    FOREIGN KEY (location_id)
    REFERENCES locations(id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_hotels_location_rating ON hotels(location_id, star_rating);

-- ========================================================
-- Địa điểm tham quan / ăn uống — crawl từ OpenTripMap 1 lần/tuần
-- (place.sync.job.js). Là nguyên liệu đầu vào cho Travel Planning Engine:
-- xid       = id của OpenTripMap (node/way/wikidata id)
-- category  = phân loại thô để query nhanh; kinds giữ nguyên chuỗi gốc
--             của OpenTripMap (vd "religion,churches,interesting_places")
--             để bước preference-matching sau này so khớp sở thích chi tiết.
-- rate      = độ nổi tiếng 0-7 theo OpenTripMap (KHÔNG phải sao/review) —
--             dùng làm proxy cho rating trong công thức scoring.
-- ========================================================
CREATE TABLE IF NOT EXISTS places (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  xid            VARCHAR(50)  NOT NULL UNIQUE,
  location_id    INT NOT NULL,

  name           VARCHAR(255) NOT NULL,
  -- Tên/mô tả tiếng Việt — enrich sau khi sync (Wikipedia tiếng Việt → Gemini dịch,
  -- xem place.enrich.job.js). NULL = chưa enrich, hiển thị fallback bản gốc.
  name_vi        VARCHAR(255) NULL,
  category       ENUM('attraction','food') NOT NULL,
  kinds          VARCHAR(500),
  address        VARCHAR(500),

  latitude       DECIMAL(9,6) NOT NULL,
  longitude      DECIMAL(9,6) NOT NULL,

  rate           TINYINT UNSIGNED DEFAULT 0,
  description    TEXT,
  description_vi TEXT NULL,
  image          VARCHAR(500),
  wikipedia      VARCHAR(500),

  -- Thời gian tham quan gợi ý (phút) — dùng khi xếp số điểm/ngày theo pace
  visit_minutes  SMALLINT UNSIGNED DEFAULT 90,
  -- Chi phí trung bình/người (USD) — OpenTripMap không có, để NULL,
  -- giai đoạn sau có thể ước lượng bằng AI hoặc nhập tay
  avg_cost       DECIMAL(12,2) NULL,

  source         ENUM('api','manual','ai_draft') DEFAULT 'api',
  is_active      TINYINT(1) DEFAULT 1,
  last_synced_at TIMESTAMP NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_places_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT
);

CREATE INDEX idx_places_location_category_rate ON places(location_id, category, rate);

-- Chuyến đi của user — đầu vào của Travel Planning Engine
CREATE TABLE IF NOT EXISTS trips (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  location_id  INT NOT NULL,
  title        VARCHAR(200),
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  budget_total DECIMAL(12,2),
  num_people   TINYINT UNSIGNED DEFAULT 1,
  -- draft: mới tạo; planning: job sinh lịch trình đang chạy;
  -- planned: đã có lịch trình; failed: job lỗi
  status       ENUM('draft','planning','planned','failed') DEFAULT 'draft',
  -- Kết quả bước AI Personalization (Gemini): tóm tắt từng ngày + tips,
  -- dạng JSON { general_tips: [...], days: [{day_index, title, summary}] }.
  -- NULL nếu AI lỗi/chưa chạy — lịch trình vẫn dùng được bình thường.
  ai_summary   JSON NULL,
  -- Snapshot chi phí tính TẠI THỜI ĐIỂM sinh lịch trình (budget-aware planning):
  -- khách sạn được chọn theo ngân sách còn lại, pace có thể bị hạ để vừa budget.
  -- Xem budget.service.js#fitBudgetForPlanning. NULL nếu chưa plan.
  budget_summary JSON NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_trips_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_trips_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT
);

CREATE INDEX idx_trips_user_status ON trips(user_id, status);

-- Job sinh lịch trình bất đồng bộ (POST /trips/:id/plan trả job_id 202,
-- client polling GET /jobs/:id). Job xử lý bởi BullMQ worker 'trip-plan'.
CREATE TABLE IF NOT EXISTS ai_jobs (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  trip_id    INT NOT NULL,
  user_id    INT NOT NULL,
  type       ENUM('plan_trip') DEFAULT 'plan_trip',
  status     ENUM('queued','processing','completed','failed') DEFAULT 'queued',
  error      VARCHAR(1000) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_jobs_trip FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  CONSTRAINT fk_jobs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Lịch trình đã sinh cho trip — output của Travel Planning Engine.
-- Mỗi row = 1 hoạt động trong 1 ngày (điểm tham quan hoặc bữa ăn),
-- day_index 1-based, order_index là thứ tự trong ngày.
-- score = điểm scoring tại thời điểm sinh (snapshot, để debug/giải thích).
CREATE TABLE IF NOT EXISTS trip_activities (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  trip_id       INT NOT NULL,
  place_id      INT NOT NULL,
  day_index     TINYINT UNSIGNED NOT NULL,
  order_index   TINYINT UNSIGNED NOT NULL,
  start_time    TIME NULL,
  activity_type ENUM('visit','meal') DEFAULT 'visit',
  score         DECIMAL(5,4) NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_trip_day_order (trip_id, day_index, order_index),

  CONSTRAINT fk_activities_trip
    FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  CONSTRAINT fk_activities_place
    FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE RESTRICT
);

-- Sở thích du lịch — 1 dòng/user, dùng cho bước Filtering & Scoring.
-- 4 trọng số w_* phải cộng lại = 1.0 (mặc định 0.35/0.25/0.25/0.15 theo
-- tài liệu thiết kế); validate ở tầng service.
CREATE TABLE IF NOT EXISTS user_preferences (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL UNIQUE,
  interests    JSON,
  pace         ENUM('relaxed','moderate','packed') DEFAULT 'moderate',
  w_price      DECIMAL(3,2) DEFAULT 0.35,
  w_rating     DECIMAL(3,2) DEFAULT 0.25,
  w_distance   DECIMAL(3,2) DEFAULT 0.25,
  w_preference DECIMAL(3,2) DEFAULT 0.15,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_prefs_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
