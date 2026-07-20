require('dotenv').config();
const axios = require('axios');

const API_KEY = process.env.MAKCORPS_API_KEY;
if (!API_KEY) {
  console.error('Thiếu MAKCORPS_API_KEY trong .env');
  process.exit(1);
}

const BASE_URL = 'https://api.makcorps.com';

// Bước 1: Map tên hotel -> document_id (hotelid)
async function mapHotel(name) {
  const { data } = await axios.get(`${BASE_URL}/mapping`, {
    params: { api_key: API_KEY, name },
  });

  // Lọc chỉ lấy kết quả type = HOTEL (loại bỏ GEO/ATTRACTION)
  const hotels = data.filter((item) => item.type === 'HOTEL');

  console.log(`\n=== Kết quả mapping cho "${name}" ===`);
  hotels.forEach((h) => {
    console.log(`- ${h.name} -> hotelid: ${h.document_id}`);
  });

  return hotels;
}

// Bước 2: Lấy giá theo hotelid
async function getHotelPrice(hotelid, checkin, checkout, opts = {}) {
  const { data } = await axios.get(`${BASE_URL}/hotel`, {
    params: {
      api_key: API_KEY,
      hotelid,
      checkin,
      checkout,
      adults: opts.adults || 1,
      rooms: opts.rooms || 1,
      cur: opts.cur || 'USD',
    },
  });
  return data;
}

(async () => {
  try {
    // 1. Map tên hotel Hà Nội -> hotelid
    const hotels = await mapHotel('Sofitel Legend Metropole Hanoi');
    if (hotels.length === 0) {
      console.log('Không tìm thấy hotel nào, thử đổi tên search.');
      return;
    }
    const hotelid = hotels[0].document_id;

    // 2. Test giá 1 đêm
    console.log(`\n=== Giá 1 đêm (hotelid=${hotelid}) ===`);
    const price1Night = await getHotelPrice(hotelid, '2026-07-07', '2026-07-08');
    console.log(JSON.stringify(price1Night, null, 2));

    // 3. Test giá 3 đêm -- để so sánh xem có chia đều hay khác biệt thật
    console.log(`\n=== Giá 3 đêm (hotelid=${hotelid}) ===`);
    const price3Nights = await getHotelPrice(hotelid, '2026-07-07', '2026-07-10');
    console.log(JSON.stringify(price3Nights, null, 2));

    console.log('\n=== So sánh ===');
    console.log('So total 3 đêm có = total 1 đêm x 3 không (nếu = thì chỉ là chia đều, không phải giá thật từng đêm)');
  } catch (err) {
    if (err.response) {
      console.error('Lỗi API:', err.response.status, err.response.data);
    } else {
      console.error('Lỗi:', err.message);
    }
  }
})();