# CLAUDE.md

Hướng dẫn cho Claude Code khi làm việc trong repo này.

## Tổng quan dự án

**XeDich** (langgit-backend) — Backend cho ứng dụng lập kế hoạch du lịch ngân sách bằng AI.
Node.js + Express + MySQL + Redis. Đây là backend của đồ án "Hệ thống Lập kế hoạch
Du lịch Thông minh" với module lõi là **Travel Planning Engine** (pipeline 6 bước — xem
`Tai_lieu_Phan_tich_Thiet_ke_Day_du_He_thong_Du_lich_AI.docx` để hiểu thiết kế tổng thể).

Trạng thái hiện tại: đã có các module auth, user (kèm preferences), hotel_liteapi (LiteAPI),
flight (Ignav, đang là file test), place (OpenTripMap), trip (CRUD), **itinerary (Planning
Engine — giai đoạn 2+3 ĐÃ XONG, chạy BẤT ĐỒNG BỘ)**: `POST /trips/:id/plan` trả 202 `{job_id}`
(BullMQ queue `trip-plan`, bảng `ai_jobs`), client polling `GET /jobs/:id`; worker chạy pipeline
scoring → k-means clustering theo ngày → nearest-neighbor route → xếp giờ + bữa ăn → lưu
`trip_activities` → bước **AI Personalization bằng Gemini** (`gemini-flash-latest`, free tier)
viết tóm tắt ngày + tips tiếng Việt vào `trips.ai_summary`. AI là best-effort: Gemini lỗi thì
job vẫn completed, chỉ thiếu ai_summary.

**Lịch sử quan trọng:** dự án từng có module `modules/hotel` gọi API **Xotelo** (sync khách sạn
+ cache giá theo đêm vào MySQL bằng cron + BullMQ). Xotelo đã sập (2026-07) nên module này —
cùng bảng `hotels`/`hotel_prices`/`locations` kiểu cũ, và các script phụ trợ (`sync_hotel.js`,
`Check_queue.js`) — đã bị **xoá hoàn toàn**. `hotel_liteapi` là module hotel duy nhất còn lại,
dùng **LiteAPI** (đã có key production trong `.env`, không còn sandbox).

`hotel_liteapi` giờ có 2 luồng dữ liệu khác nhau (đọc kỹ trước khi sửa, xem thêm mục Kiến trúc):
- **Dữ liệu tĩnh khách sạn** (tên, địa chỉ, ảnh, toạ độ, rating) được **crawl 1 lần/tuần** vào
  bảng `hotels`/`locations` mới (`hotel.sync.job.js`, cron thứ 2 hằng tuần) — vì dữ liệu này
  gọi live sẽ chậm (~340ms/request) và tốn quota LiteAPI cho mỗi lượt tìm kiếm trùng lặp.
  `findByCity` đọc DB trước, chỉ fallback gọi live khi thành phố chưa được crawl.
- **Giá phòng** (`/rates`) LUÔN gọi live (đo thực tế: ~10s lúc cache miss, ~0.7s khi cache hit),
  KHÔNG crawl trước vào DB — giá phụ thuộc tổ hợp ngày/số khách gần như vô hạn tổ hợp, và giá
  đổi liên tục (phòng hết chỗ, dynamic pricing) nên crawl trước dễ hiển thị giá sai. Chỉ có cache
  in-memory 5 phút (`shared/utils/cache.js`) để giảm gọi trùng lặp gần nhau.

## Lệnh thường dùng

```bash
npm run dev            # Chạy dev với nodemon (src/server.js)
npm start              # Chạy production
npm test               # Jest + coverage
npm run lint           # ESLint trên src/
npm run format         # Prettier trên src/

docker compose up -d   # MySQL (host port 3636), Redis (6379), phpMyAdmin (8080), backend (5000)
```

Trigger crawl thủ công (không cần đợi cron hằng tuần), chạy trong container:

```bash
# Khách sạn (cron thật: 0h thứ 2)
docker exec xedich_backend node -e "require('./src/modules/hotel_liteapi/hotel.sync.job').syncAllCities().then(()=>process.exit(0))"
# Địa điểm tham quan/ăn uống (cron thật: 0h thứ 3; mất ~2-3 phút do giãn cách call detail)
docker exec xedich_backend node -e "require('./src/modules/place/place.sync.job').syncAllCities().then(()=>process.exit(0))"
# Việt hoá + bù ảnh + ước tính chi phí places (tự chạy cuối sync, nhưng trigger riêng được;
# idempotent; lần đầu mất khá lâu do giãn cách Wikipedia + rate limit Gemini free tier
# (dịch + ước tính chi phí đều qua Gemini, batch riêng — xem place.enrich.job.js)
docker exec xedich_backend node -e "require('./src/modules/place/place.enrich.job').enrichAllPlaces().then(()=>process.exit(0))"
# Chỉ ước tính chi phí (không dịch lại) — dùng khi cần điền avg_cost gấp cho budget module
docker exec xedich_backend node -e "require('./src/modules/place/place.enrich.job').enrichCostsFromGemini().then(()=>process.exit(0))"
# Lọc địa điểm trùng (tự chạy cuối sync sau enrich; idempotent; soft-delete is_active=0)
docker exec xedich_backend node -e "require('./src/modules/place/place.dedupe.job').dedupeAllPlaces().then(()=>process.exit(0))"
```

Yêu cầu: Node >= 18. Docker image dùng node:20-alpine.

## Hạ tầng local (docker-compose)

| Service    | Container         | Port host | Ghi chú                                    |
|------------|-------------------|-----------|---------------------------------------------|
| MySQL 8    | xedich_mysql      | **3636**  | DB `xedich_db`, init SQL trong `database/`  |
| Redis 7    | xedich_redis      | 6379      | Dùng cho cache OTP                          |
| phpMyAdmin | xedich_phpmyadmin | 8080      |                                             |
| Backend    | xedich_backend    | 5000      | Trong compose, DB_HOST=mysql, DB_PORT=3306, `env_file: .env` |

Lưu ý: MySQL map ra **cổng 3636** trên host (không phải 3306). Timezone DB là Asia/Ho_Chi_Minh,
charset utf8mb4. Sau khi sửa `docker-compose.yml`, dùng `docker compose up -d` (không phải
`restart`) để container nhận cấu hình mới.

## Kiến trúc & cấu trúc thư mục

Modular monolith theo domain, mỗi module đi theo tầng **route → controller → service → repository**:

```
database/
├── init.sql                   # Schema DB — nguồn sự thật duy nhất (xem mục Database)
└── locations.seeder.sql       # Seed 17 thành phố VN (city_name đã verify khớp LiteAPI)
src/
├── server.js                  # Entry: dotenv, app.listen, nạp hotel.sync.job (cron)
├── app.js                     # Express app: helmet, cors (credentials), rate limit, cookie-parser,
│                               # mount routes, global error handler (hotel_liteapi/error.handler.js)
├── modules/
│   ├── auth/                  # Đăng ký/đăng nhập, JWT, OTP qua email (Redis, TTL 5 phút)
│   ├── user/                  # Route yêu cầu auth; PUT /:id chỉ tự sửa hồ sơ mình;
│   │                           # GET/PUT /users/me/preferences (sở thích + 4 trọng số scoring,
│   │                           # tổng phải = 1.0, lazy-init bản ghi mặc định)
│   ├── flight/                # Ignav API: flight.service.js (searchOneWay + getCheapestOneWayPrice,
│   │                           # cache 10 phút, không throw khi lỗi — budget coi vé bay là optional);
│   │                           # test.js = route GET /flights (nên đổi tên thành flight.route.js sau)
│   ├── budget/                # Chi phí chuyến đi — 2 vai trò:
│   │                           # 1. GET /trips/:id/budget?origin=HAN (on-demand, có vé bay Ignav)
│   │                           # 2. fitBudgetForPlanning + buildPlanBudgetSummary — được itinerary
│   │                           #    gọi TRONG pipeline sinh lịch trình (budget-aware planning):
│   │                           #    với mỗi pace ứng viên, SINH THẬT lịch trình (generateItinerary,
│   │                           #    thuật toán thuần nên gọi lặp lại rẻ) rồi tính ăn/vé/di chuyển từ
│   │                           #    ĐÚNG route+quán+điểm vừa sinh (không còn ước lượng qua số lượng)
│   │                           #    → lấy giá khách sạn thật → trừ chi phí cố định vừa tính → chọn
│   │                           #    khách sạn đắt nhất còn ≤85% ngân sách còn lại (chừa dự phòng)
│   │                           #    → nếu không đủ thì HẠ PACE dần (packed→moderate→relaxed) và THỬ
│   │                           #    LẠI TOÀN BỘ → vẫn thiếu thì cảnh báo trong warnings[]. Lịch trình
│   │                           #    được chọn trả kèm trong fit.activities — itinerary.service.js
│   │                           #    dùng thẳng để lưu, không sinh lại lần 2. Kết quả lưu
│   │                           #    trips.budget_summary (đọc kèm GET /trips/:id/itinerary).
│   │                           # Vé tham quan + ăn uống (trưa/tối) dùng avg_cost THẬT của từng điểm/
│   │                           #    quán đã chọn (enrich bởi place.enrich.job.js#enrichCostsFromGemini,
│   │                           #    xem mục place/ bên dưới); di chuyển tính theo tổng khoảng cách
│   │                           #    Haversine thật giữa các điểm trong ngày × hệ số đường bộ × cước
│   │                           #    xe máy/ô tô theo num_people (BUDGET_TRANSPORT_*_VND). Các hằng số
│   │                           #    BUDGET_MEAL_COST_VND/BUDGET_ATTRACTION_FEE_VND chỉ còn là fallback
│   │                           #    khi avg_cost chưa enrich, bữa sáng (không gắn quán cụ thể), hoặc
│   │                           #    GET /trips/:id/budget gọi trước khi có lịch trình.
│   │                           # Khách sạn ở ghép 2 người/phòng.
│   ├── location/              # location.repository.js — bảng `locations`. KHÔNG có route,
│   │                           # dùng nội bộ bởi hotel_liteapi, place, trip
│   ├── place/                 # Địa điểm tham quan/ăn uống — OpenTripMap
│   │   ├── opentripmap.client.js  # axios client (key qua query param `apikey`), retry cả 429
│   │   ├── place.repository.js    # fetchRadius/fetchDetail (API) + bulkUpsertPlaces/findByLocation (DB)
│   │   ├── place.sync.job.js      # Cron 0h THỨ 3 hằng tuần (lệch hotel sync thứ 2); dedupe theo
│   │   │                           # tên, chỉ gọi detail cho điểm rate>=2 (tiết kiệm quota 5k/ngày);
│   │   │                           # cuối syncAllCities gọi enrich job (best-effort)
│   │   ├── place.enrich.job.js    # Việt hoá + bù ảnh + ước tính chi phí (idempotent, chạy lại thoải mái):
│   │   │                           # 1) Wikipedia: langlinks EN→VI → tên bài = name_vi, extract =
│   │   │                           #    description_vi, thumbnail bù image (không key, free)
│   │   │                           # 2) Gemini dịch batch attraction rate>=2 còn thiếu (6 điểm/call,
│   │   │                           #    giãn 20s vì free tier ~15 req/phút). KHÔNG dịch tên quán ăn/
│   │   │                           #    điểm thường — tên OSM bản địa đa số đã là tiếng Việt
│   │   │                           # 3) enrichCostsFromGemini: ước tính avg_cost (vé vào cửa/giá 1 suất
│   │   │                           #    ăn, VND) cho MỌI điểm còn NULL avg_cost (cả 2 category, không
│   │   │                           #    lọc rate — dùng bởi budget module). Batch 40 điểm/call (chỉ trả
│   │   │                           #    số nên gộp lớn hơn dịch được), clamp 0..5tr VND chống bịa giá.
│   │   ├── place.dedupe.job.js    # Lọc trùng (OSM nhiều node/địa danh): gộp theo trùng wikipedia
│   │   │                           # HOẶC tên chuẩn hoá (bỏ dấu) + cùng category + đủ gần (food
│   │   │                           # <=100m vì quán chuỗi, attraction <=500m); giữ bản tốt nhất,
│   │   │                           # gộp field thiếu, soft-delete phần thừa (is_active=0)
│   │   └── place.service/controller/route.js  # GET /places?city_code=&category=&min_rate=
│   ├── trip/                  # CRUD chuyến đi (yêu cầu auth, ownership 404, chỉ sửa khi draft,
│   │                           # validate: max 14 đêm, không ở quá khứ, num_people 1-20);
│   │                           # route cũng mount POST /:id/plan + GET /:id/itinerary (itinerary)
│   ├── itinerary/             # Travel Planning Engine (BẤT ĐỒNG BỘ qua BullMQ)
│   │   ├── planning.engine.js     # Thuật toán THUẦN (không DB/HTTP, dễ unit test): dedupe
│   │   │                           # (wiki trùng hoặc <250m cùng category) → scoring (4 trọng số,
│   │   │                           # rating chuẩn hoá theo max rate THÀNH PHỐ, không phải /7) →
│   │   │                           # k-means k=số ngày (init rải theo kinh độ, deterministic) →
│   │   │                           # balance cluster → nearest-neighbor route → xếp giờ
│   │   │                           # (08:30 bắt đầu, +30' di chuyển/điểm, trưa 11:30, tối 18:30)
│   │   ├── plan.queue.js          # BullMQ queue+worker 'trip-plan' (concurrency 2); job lifecycle
│   │   │                           # ai_jobs: queued→processing→completed/failed; AI best-effort
│   │   ├── ai.personalizer.js     # Bước 5: prompt Gemini (JSON mode) → general_tips + tóm tắt
│   │   │                           # ngày + food_suggestions tiếng Việt → trips.ai_summary
│   │   ├── feedback.interpreter.js # POST /trips/:id/adjust — diễn giải góp ý tự do (vd "bỏ Bitexco",
│   │   │                           # "đi chậm hơn") qua Gemini thành directive có cấu trúc
│   │   │                           # (exclude_place_ids/pace/interests_add-remove). KHÁC ai.personalizer:
│   │   │                           # đây là bước FUNCTIONAL — lỗi Gemini phải throw (controller trả lỗi
│   │   │                           # cho user thử lại), không best-effort im lặng bỏ qua.
│   │   ├── itinerary.service.js   # Orchestration: gom dữ liệu, gọi engine, group theo ngày.
│   │   │                           # planTrip đọc trips.itinerary_adjustments (nếu có) để lọc bỏ
│   │   │                           # exclude_place_ids khỏi attractions/foods và ghi đè pace/interests
│   │   │                           # CHỈ cho lần sinh này (không đụng user_preferences toàn cục).
│   │   │                           # submitFeedback gọi feedback.interpreter rồi CỘNG DỒN kết quả vào
│   │   │                           # itinerary_adjustments (không tự sinh lại — controller enqueue lại
│   │   │                           # đúng job 'trip-plan' sẵn có, tái dùng toàn bộ hạ tầng polling).
│   │   ├── itinerary.repository.js # saveItinerary chạy TRANSACTION (xoá cũ→insert→status=planned)
│   │   ├── job.repository.js      # CRUD bảng ai_jobs + chống double-enqueue (findActiveJobByTrip)
│   │   │                           # + saveTripAdjustments (itinerary_adjustments)
│   │   ├── job.route.js           # GET /jobs/:id — polling (auth, chỉ thấy job của mình)
│   │   └── itinerary.controller.js # + POST /trips/:id/adjust (adjustTrip) — trả changes_summary
│   │                                # ngay (không cần đợi job xong) để FE hiện xác nhận sớm
│   └── hotel_liteapi/         # Module hotel DUY NHẤT — LiteAPI (api.liteapi.travel/v3.0)
│       ├── liteapi.client.js      # axios client, timeout 15s, keep-alive, retry (withRetry)
│       ├── hotel.repository.js    # findByCity đọc DB trước (fallback live+cache); findByIds/
│       │                           # findById/getRates luôn live+cache 5 phút-1 giờ;
│       │                           # bulkUpsertHotels + fetchCityHotelsFromApi cho sync job
│       ├── hotel.sync.job.js      # Cron 0h thứ 2 hằng tuần: crawl dữ liệu tĩnh vào bảng `hotels`
│       ├── hotel.service.js / hotel.controller.js / hotel.route.js (có rate limit riêng)
│       └── error.handler.js       # Global error handler (dùng chung trong app.js)
├── chat/ community/   # Scaffold rỗng — tính năng cộng đồng/chat tương lai
└── shared/
    ├── config/database.js     # mysql2/promise pool (connectionLimit 10)
    ├── config/redis.js        # ioredis (dùng cho OTP)
    ├── middlewares/auth.middleware.js  # JWT từ cookie `token` hoặc Bearer header → req.user.id
    └── utils/response.js, cache.js (in-memory TTL cache), mailer.js (Resend),
        otp.js (OTP 6 số, TTL 5 phút trong Redis)
```

## Quy ước code

- **CommonJS** (`require`/`module.exports`), không dùng ESM.
- Module mới đi theo đúng tầng: `*.route.js` → `*.controller.js` → `*.service.js` → `*.repository.js`.
  Controller chỉ gọi service và `next(err)`; validate input trong service; DB/API nằm ở repository.
- **Response chuẩn** qua `shared/utils/response.js`:
  `{ success, message, data }` (+ `meta` với `paginated`, + `errors` khi lỗi validate).
  Không tự `res.json` trực tiếp trong controller.
- Lỗi ném ra từ service được đẩy về global `error.handler.js` qua `next(err)`; lỗi nghiệp vụ đã
  biết thì gán `error.statusCode` (xem `auth.service.js`) để controller/error handler trả đúng mã.
- **Message hướng người dùng và log viết bằng tiếng Việt** (giữ nhất quán với code hiện có),
  log có prefix module dạng `[AuthController]`, `[Redis]`...
- Comment giải thích "vì sao" (đặc biệt các FIX về hiệu năng/bảo mật) — giữ và cập nhật
  các block comment này khi sửa code liên quan, đừng xoá.
- Auth: `authenticate` middleware (`shared/middlewares/auth.middleware.js`) đọc JWT từ cookie
  `token` hoặc `Authorization: Bearer`, gắn `req.user = { id }`. Route nào cần đăng nhập thì
  `router.use(authenticate)` ở đầu file route.
- Route nhạy cảm (auth: register/login/OTP) phải có rate limit (`express-rate-limit`,
  xem `auth.route.js`) để chống brute-force.
- Ngày dùng chuỗi `YYYY-MM-DD`, guestNationality mặc định VN. **Tiền tệ mặc định VND**:
  giá khách sạn lấy VND trực tiếp từ LiteAPI (`currency` mặc định "VND" trong
  `hotel.service.js#getRates`, client vẫn override được); vé bay Ignav chỉ trả USD →
  budget quy đổi qua env `USD_VND_RATE` (mặc định 26500, cập nhật tay); đơn giá ước tính
  ăn uống/vé/di chuyển qua env `BUDGET_*_VND`; VND làm tròn về nghìn đồng (`roundVnd`).
  `trips.budget_total` hiểu là VND.
- MySQL DATE qua mysql2 thành JS Date object — **KHÔNG** dùng `String(d).slice(0,10)`
  (ra "Sun Sep 20") hay `toISOString()` (lùi 1 ngày do TZ). Dùng helper `toDateStr` với
  local getters (đã có ở `budget.service.js` và `hotel.repository.js`).

## Database — schema & cách quản lý thay đổi

Schema nằm trong **`database/init.sql`**, được docker-compose mount vào
`/docker-entrypoint-initdb.d/` của MySQL.

**Dự án KHÔNG dùng migration tool** (không Knex migrations, không Flyway). Quy trình hiện tại
là "code đến đâu sửa DB đến đó":

- Mọi thay đổi schema phải sửa trực tiếp vào `database/init.sql` — file này là **nguồn sự thật
  duy nhất** về schema. Khi thêm/sửa bảng trong code (repository), luôn cập nhật `init.sql` tương ứng.
- Lưu ý: script trong `docker-entrypoint-initdb.d` **chỉ chạy khi volume MySQL còn trống**.
  DB đang chạy sẽ KHÔNG tự nhận thay đổi — khi sửa schema, phải kèm câu lệnh `ALTER TABLE`/`DROP TABLE`
  cho người dùng chạy tay (qua phpMyAdmin cổng 8080 hoặc mysql CLI), hoặc hướng dẫn
  `docker compose down -v` để tạo lại từ đầu (mất dữ liệu).
- Viết SQL theo phong cách hiện có: `CREATE TABLE IF NOT EXISTS`, utf8mb4, timezone +07:00,
  `created_at`/`updated_at` TIMESTAMP với `ON UPDATE`, comment tiếng Việt giải thích lý do thiết kế.

### Các bảng hiện có

| Bảng               | Vai trò                                                                              |
|--------------------|----------------------------------------------------------------------------------|
| `users`            | Tài khoản: name, email (unique), password, avatar, `provider` ENUM('local','google') |
| `locations`        | Thành phố hỗ trợ: `city_code` (slug), `city_name` (PHẢI khớp tên LiteAPI nhận), `latitude`/`longitude` (tâm crawl OpenTripMap), `crawl_radius_m`, `airport_code` (IATA gần nhất — cho ước tính vé bay) |
| `hotels`           | Cache dữ liệu TĨNH khách sạn từ LiteAPI, đồng bộ 1 lần/tuần: `hotel_id` (unique, id LiteAPI), FK `location_id`. **KHÔNG lưu giá** — giá luôn gọi live |
| `places`           | Địa điểm tham quan/ăn uống từ OpenTripMap (tuần/lần): `xid` (unique), `category` ENUM('attraction','food'), `kinds` (chuỗi gốc OTM cho preference-matching), `rate` 0-7 (độ nổi tiếng, proxy rating), `visit_minutes`, `avg_cost` (NULL — OTM không có, bổ sung sau), `name_vi`/`description_vi` (Việt hoá bởi place.enrich.job — NULL = chưa enrich, frontend fallback bản gốc) |
| `trips`            | Chuyến đi: FK user/location, ngày đi/về, budget, `status` ENUM('draft','planning','planned','failed'), `ai_summary` JSON (Gemini), `budget_summary` JSON (snapshot chi phí lúc plan, budget-aware) |
| `trip_activities`  | Lịch trình đã sinh: FK trip (CASCADE)/place (RESTRICT), `day_index`/`order_index` (unique cùng trip), `start_time`, `activity_type` ENUM('visit','meal'), `score` snapshot |
| `ai_jobs`          | Job sinh lịch trình: FK trip/user (CASCADE), `status` ENUM('queued','processing','completed','failed'), `error` — nguồn sự thật cho polling GET /jobs/:id (BullMQ job trong Redis chỉ là hàng đợi) |
| `user_preferences` | 1 dòng/user: `interests` JSON, `pace`, 4 trọng số `w_*` (mặc định 0.35/0.25/0.25/0.15, tổng = 1.0) |

Lưu ý quan trọng: `hotels`/`locations` hiện tại **khác hoàn toàn schema Xotelo cũ** (dùng
`hotel_id` thay vì `hotel_key`, không có `location_key`/`min_price`/`max_price`). Nếu thấy lỗi
kiểu "Unknown column" hoặc "Duplicate key name" khi áp `init.sql` vào DB đang chạy, khả năng cao
là DB còn sót bảng theo schema cũ chưa được `DROP TABLE` — xoá thủ công theo thứ tự
`hotel_prices` → `hotels` → `locations` (FK) rồi áp lại `init.sql` + `locations.seeder.sql`.

Thêm thành phố mới: thêm vào `database/locations.seeder.sql` — **phải test `cityName` với
LiteAPI trước** (`GET /data/hotels?countryCode=..&cityName=..&limit=1`, xem `total` > 0) vì tên
thành phố sai chính tả/thiếu dấu sẽ trả 0 kết quả mà không báo lỗi.

## Biến môi trường

Xem `.env.example` (đầy đủ nhất). Nhóm chính: `PORT`, `FRONTEND_URL`; MySQL `DB_*`
(local host port 3636); `REDIS_HOST`/`REDIS_PORT`; `JWT_SECRET` (phải là chuỗi ngẫu nhiên mạnh,
KHÔNG dùng giá trị mặc định trong `.env.example`), `JWT_EXPIRES_IN`; `RESEND_API_KEY`, `MAIL_FROM`;
`GOOGLE_CLIENT_ID/SECRET`; `LITEAPI_BASE_URL`, `LITEAPI_API_KEY`; `IGNAV_API_KEY`;
`OPENTRIPMAP_BASE_URL`, `OPENTRIPMAP_API_KEY` (free plan ~5000 req/ngày — sync job đã được
thiết kế tiết kiệm call, đừng thêm vòng lặp gọi detail cho mọi điểm); `GEMINI_KEY` +
`LLM_MODEL` (mặc định `gemini-flash-latest` — Gemini free tier 1500 req/ngày, key qua header
`x-goog-api-key`, client ở `shared/config/llm.client.js`); `GOOGLE_MAPS_API_KEY`;
`HOTEL_SYNC_MAX_PER_CITY` (optional, mặc định 1000).

**Lưu ý Docker + env:** `docker compose restart` KHÔNG nạp lại `env_file` — sau khi sửa `.env`
phải `docker compose up -d --force-recreate backend` (đã dính bug này 2 lần: LITEAPI key mới
và GEMINI_KEY không vào container).

**Không bao giờ commit `.env` hay hard-code API key.** Khi thêm biến mới phải cập nhật
`.env.example` (chỉ đặt placeholder, không đặt giá trị thật).

## Định hướng phát triển (theo tài liệu thiết kế)

Khi xây tính năng mới, bám theo tài liệu phân tích thiết kế:

- Travel Planning Engine pipeline 6 bước: Data Aggregation → Filtering & Scoring →
  Geo-clustering → Route Optimization → AI Personalization (OpenAI) → Itinerary Generation.
- Scoring: `score = w1*price + w2*rating + w3*distance + w4*preference_match`
  (trọng số mặc định 0.35 / 0.25 / 0.25 / 0.15, tuỳ chỉnh theo `user_preferences`).
- API sinh lịch trình bất đồng bộ (`POST /trips/:id/plan` → 202 job_id → polling
  `GET /jobs/:id`) — **ĐÃ TRIỂN KHAI** (BullMQ queue `trip-plan`, xem modules/itinerary/).
- Các bảng dự kiến: `trips`, `activities`, `scoring_results`, `ai_jobs`, `places`,
  `user_preferences` — schema chi tiết trong tài liệu docx.

## Kiểm tra trước khi hoàn thành

1. `npm run lint` và `npm run format` sạch.
2. `npm test` pass (Jest + supertest cho API).
3. Nếu đụng route/middleware auth: test thủ công đăng ký → OTP → login → gọi route
   được bảo vệ bằng cookie, đảm bảo không phá luồng xác thực.
