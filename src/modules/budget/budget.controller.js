const budgetService = require("./budget.service");
const response = require("../../shared/utils/response");

const getBudget = async (req, res) => {
  try {
    const result = await budgetService.estimateBudget(
      req.user.id,
      Number(req.params.id),
      { origin: req.query.origin }
    );
    return response.ok(res, result, "Ước tính ngân sách thành công");
  } catch (error) {
    if (error.statusCode) {
      return response.error(res, error.message, error.statusCode);
    }
    console.error("[BudgetController]", error);
    return response.error(res, "Đã có lỗi xảy ra khi ước tính ngân sách", 500);
  }
};

module.exports = { getBudget };
