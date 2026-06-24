const hotelService = require('./hotel.service');
const response = require('../../shared/utils/response');

const search = async (req, res) => {
    try{
        const { city, check_in, check_out, budget, limit, min_rating, page, page_size } = req.query;

        if(!city || !check_in || !check_out) {
            return response.error(res, 'Missing required query parameters', 400);
        }

        validateDates(check_in, check_out);

        const result = await hotelService.searchHotelsWithPrice({
            city,
            checkIn: check_in,
            checkOut: check_out,
            budget,
            limit:     limit     ? parseInt(limit)        : undefined,
            minRating: min_rating ? parseFloat(min_rating) : undefined,
            page:      page      ? parseInt(page)         : 1,
            pageSize:  page_size ? parseInt(page_size)    : 10,
        });

        return response.ok(res, result, `Tìm thấy ${result.pagination.total} khách sạn`, 200);
    } catch (error) {
        console.error('Error in hotel search:', error);
        return response.error(res, error.message || 'Internal Server Error', 500);
    }
}

const detail = async (req, res) => {
    try {
        const { hotelKey } = req.params;
        const { check_in, check_out } = req.query;
        validateDates(check_in, check_out);

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

const validateDates = (checkIn, checkOut) => {
    const inDate = new Date(checkIn);
    const outDate = new Date(checkOut);

    if (Number.isNaN(inDate.getTime()) ||
        Number.isNaN(outDate.getTime())) {
        throw new Error('Invalid date format');
    }

    if (outDate <= inDate) {
        throw new Error('check_out must be greater than check_in');
    }

    const nights =
        (outDate - inDate) / (1000 * 60 * 60 * 24);

    if (nights > 30) {
        throw new Error('Maximum stay is 30 nights');
    }
};

module.exports = { search, detail };