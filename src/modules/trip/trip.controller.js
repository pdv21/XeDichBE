const tripService = require("./trip.service");
const response = require("../../shared/utils/response");

const handleError = (res, error, fallbackMessage) => {
  if (error.statusCode) {
    return response.error(res, error.message, error.statusCode);
  }
  console.error("[TripController]", error);
  return response.error(res, fallbackMessage, 500);
};

const createTrip = async (req, res) => {
  try {
    const { city_code, title, start_date, end_date, budget_total, num_people, meal_cost_vnd } = req.body;
    const trip = await tripService.createTrip(req.user.id, {
      cityCode: city_code,
      title,
      startDate: start_date,
      endDate: end_date,
      budgetTotal: budget_total,
      numPeople: num_people,
      mealCostVnd: meal_cost_vnd,
    });
    return response.created(res, trip, "Tạo chuyến đi thành công");
  } catch (error) {
    return handleError(res, error, "Đã có lỗi xảy ra khi tạo chuyến đi");
  }
};

const getMyTrips = async (req, res) => {
  try {
    const { page, page_size } = req.query;
    const result = await tripService.getMyTrips(req.user.id, { page, pageSize: page_size });
    return response.paginated(res, result.trips, result.pagination, "Lấy danh sách chuyến đi thành công");
  } catch (error) {
    return handleError(res, error, "Đã có lỗi xảy ra khi lấy danh sách chuyến đi");
  }
};

const getTripById = async (req, res) => {
  try {
    const trip = await tripService.getOwnedTrip(req.user.id, Number(req.params.id));
    return response.ok(res, trip, "Lấy chi tiết chuyến đi thành công");
  } catch (error) {
    return handleError(res, error, "Đã có lỗi xảy ra khi lấy chuyến đi");
  }
};

const updateTrip = async (req, res) => {
  try {
    const { city_code, title, start_date, end_date, budget_total, num_people, meal_cost_vnd } = req.body;
    const trip = await tripService.updateTrip(req.user.id, Number(req.params.id), {
      cityCode: city_code,
      title,
      startDate: start_date,
      endDate: end_date,
      budgetTotal: budget_total,
      numPeople: num_people,
      mealCostVnd: meal_cost_vnd,
    });
    return response.ok(res, trip, "Cập nhật chuyến đi thành công");
  } catch (error) {
    return handleError(res, error, "Đã có lỗi xảy ra khi cập nhật chuyến đi");
  }
};

const deleteTrip = async (req, res) => {
  try {
    await tripService.deleteTrip(req.user.id, Number(req.params.id));
    return response.ok(res, null, "Xoá chuyến đi thành công");
  } catch (error) {
    return handleError(res, error, "Đã có lỗi xảy ra khi xoá chuyến đi");
  }
};

module.exports = { createTrip, getMyTrips, getTripById, updateTrip, deleteTrip };
