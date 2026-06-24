const hotelService = require('./hotel.service');
const response = require('../../shared/utils/response');

const search = async (req, res) => {
    try{
        const {city, check_in, check_out, budget} = req.query;

        if(!city || !check_in || !check_out) {
            return response.error(res, 'Missing required query parameters', 400);
        }

        const hotels = await hotelService.searchHotelsWithPrice({
            city: city,
            checkIn: check_in,
            checkOut: check_out,
            budget: budget
        });

        return response.ok(res, hotels, `Tìm thấy ${hotels.length} khách sạn`, 200);
    } catch (error) {
        console.error('Error in hotel search:', error);
        return response.error(res, error.message || 'Internal Server Error', 500);
    }
}

const detail = async (req, res) => {
    try {
        const { hotelKey } = req.params;
        const { check_in, check_out } = req.query;

        if(!check_in || !check_out) {
            return response.error(res, 'Missing required query parameters', 400);
        }

        const data = await hotelService.getHotelDetail(hotelKey, check_in, check_out);
        return response.ok(res, data, 'Hotel detail fetched successfully', 200);
    } catch (error) {
        console.error('Error in fetching hotel detail:', error);
        return response.error(res, error.message || 'Internal Server Error', 500);
    }
}

module.exports = { search, detail };