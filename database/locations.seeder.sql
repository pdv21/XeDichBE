USE xedich_db;

-- 17 điểm đến du lịch phổ biến ở Việt Nam.
-- city_name đã được test thực tế với LiteAPI (/data/hotels?countryCode=VN&cityName=...).
-- latitude/longitude là toạ độ trung tâm — tâm bán kính crawl địa điểm OpenTripMap.
-- crawl_radius_m: nội đô 10km; đảo/vùng rộng (Phú Quốc, Hạ Long, Côn Đảo) rộng hơn.
-- airport_code: sân bay gần nhất (IATA) — thành phố không có sân bay dùng sân bay lân cận.
INSERT INTO locations (city_code, city_name, country_code, latitude, longitude, crawl_radius_m, airport_code) VALUES
    ('ho-chi-minh', 'Ho Chi Minh City', 'VN', 10.776900, 106.700900, 12000, 'SGN'),
    ('ha-noi',      'Hanoi',            'VN', 21.028500, 105.854200, 12000, 'HAN'),
    ('da-nang',     'Da Nang',          'VN', 16.054400, 108.202200, 10000, 'DAD'),
    ('hoi-an',      'Hoi An',           'VN', 15.880100, 108.338000,  8000, 'DAD'),
    ('nha-trang',   'Nha Trang',        'VN', 12.238800, 109.196700, 10000, 'CXR'),
    ('phu-quoc',    'Phu Quoc',         'VN', 10.227000, 103.963700, 25000, 'PQC'),
    ('da-lat',      'Da Lat',           'VN', 11.940400, 108.458300, 10000, 'DLI'),
    ('hue',         'Hue',              'VN', 16.463700, 107.590900, 10000, 'HUI'),
    ('vung-tau',    'Vung Tau',         'VN', 10.346000, 107.084300, 10000, 'SGN'),
    ('can-tho',     'Can Tho',          'VN', 10.045200, 105.746900, 10000, 'VCA'),
    ('sa-pa',       'Sa Pa',            'VN', 22.336400, 103.843800, 10000, 'HAN'),
    ('ha-long',     'Ha Long',          'VN', 20.959900, 107.042800, 15000, 'VDO'),
    ('quy-nhon',    'Quy Nhon',         'VN', 13.783000, 109.219600, 10000, 'UIH'),
    ('phan-thiet',  'Phan Thiet',       'VN', 10.928900, 108.102100, 12000, 'SGN'),
    ('ninh-binh',   'Ninh Binh',        'VN', 20.250600, 105.974500, 12000, 'HAN'),
    ('hai-phong',   'Hai Phong',        'VN', 20.844900, 106.688100, 10000, 'HPH'),
    ('con-dao',     'Con Dao',          'VN',  8.682900, 106.607500, 12000, 'VCS')
ON DUPLICATE KEY UPDATE
    city_name      = VALUES(city_name),
    country_code   = VALUES(country_code),
    latitude       = VALUES(latitude),
    longitude      = VALUES(longitude),
    crawl_radius_m = VALUES(crawl_radius_m),
    airport_code   = VALUES(airport_code);
