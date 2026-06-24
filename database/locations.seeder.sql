INSERT INTO locations (city_code, city_name, location_key, is_active)
VALUES
    ('ha-noi',          'Hà Nội',            'g293924',  1),
    ('ho-chi-minh',     'Hồ Chí Minh',       'g293925',  1),
    ('da-nang',         'Đà Nẵng',           'g298085',  1),
    ('khanh-hoa',       'Khánh Hòa',         'g1184689', 1),
    ('lam-dong',        'Lâm Đồng',          'g2146217', 1),
    ('quang-nam',       'Quảng Nam',         'g2146272', 1),
    ('thua-thien-hue',  'Thừa Thiên Huế',    'g2146376', 1),
    ('quang-ninh',      'Quảng Ninh',        'g2146283', 1),
    ('ba-ria-vung-tau', 'Bà Rịa - Vũng Tàu','g303946',  1),
    ('lao-cai',         'Lào Cai',           'g2146220', 1),
    ('ninh-binh',       'Ninh Bình',         'g2146239', 1),
    ('binh-thuan',      'Bình Thuận',        'g2145211', 1),
    ('ha-giang',        'Hà Giang',          'g1544599', 1),
    ('can-tho',         'Cần Thơ',           'g303942',  1),
    ('kien-giang',      'Kiên Giang',        'g2146212', 1),
    ('quang-binh',      'Quảng Bình',        'g2146269', 1),
    ('hai-phong',       'Hải Phòng',         'g303944',  1)
ON DUPLICATE KEY UPDATE
    city_name    = VALUES(city_name),
    location_key = VALUES(location_key),
    is_active    = VALUES(is_active);