const express = require("express");
const router = express.Router();
const tripController = require("./trip.controller");
const itineraryController = require("../itinerary/itinerary.controller");
const { authenticate } = require("../../shared/middlewares/auth.middleware");

// Mọi thao tác trip đều gắn với user đang đăng nhập
router.use(authenticate);

router.post("/", tripController.createTrip);
router.get("/", tripController.getMyTrips);
router.get("/:id", tripController.getTripById);
router.put("/:id", tripController.updateTrip);
router.delete("/:id", tripController.deleteTrip);

// Travel Planning Engine: sinh + xem lịch trình tham quan
router.post("/:id/plan", itineraryController.planTrip);
router.get("/:id/itinerary", itineraryController.getItinerary);
// Chỉnh sửa lịch trình bằng góp ý tự do — diễn giải qua AI rồi sinh lại lịch trình
router.post("/:id/adjust", itineraryController.adjustTrip);

// Ước tính ngân sách (khách sạn + vé bay ?origin=HAN + ăn uống + vé tham quan)
const budgetController = require("../budget/budget.controller");
router.get("/:id/budget", budgetController.getBudget);

module.exports = router;
