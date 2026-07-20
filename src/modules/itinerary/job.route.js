const express = require("express");
const router = express.Router();
const itineraryController = require("./itinerary.controller");
const { authenticate } = require("../../shared/middlewares/auth.middleware");

router.use(authenticate);

// Polling trạng thái job sinh lịch trình (job_id từ POST /trips/:id/plan)
router.get("/:id", itineraryController.getJob);

module.exports = router;
