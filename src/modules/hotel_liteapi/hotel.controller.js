const hotelService = require("./hotel.service");
const response = require("../../shared/utils/response");

const searchByCity = async (req, res, next) => {
  try {
    const { total, hotels } = await hotelService.searchByCity(req.query);
    return response.paginated(res, hotels, { total }, "Tìm khách sạn thành công");
  } catch (err) {
    next(err);
  }
};

const searchByIds = async (req, res, next) => {
  try {
    const { total, hotels } = await hotelService.searchByIds(req.query.ids);
    return response.paginated(res, hotels, { total }, "Tìm khách sạn thành công");
  } catch (err) {
    next(err);
  }
};

const getDetail = async (req, res, next) => {
  try {
    const { hotel } = await hotelService.getDetail(req.params.hotelId);
    return response.ok(res, hotel, "Lấy chi tiết khách sạn thành công");
  } catch (err) {
    next(err);
  }
};

const getRates = async (req, res, next) => {
  try {
    const { total, rates } = await hotelService.getRates(req.body);
    return response.paginated(res, rates, { total }, "Lấy giá phòng thành công");
  } catch (err) {
    next(err);
  }
};

module.exports = { searchByCity, searchByIds, getDetail, getRates };