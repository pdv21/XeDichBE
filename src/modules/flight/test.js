const express = require("express");
const router = express.Router();
const response = require("../../shared/utils/response");
const flightService = require("./flight.service");

router.get("/", async (req, res) => {
    const { origin, destination, departure_date, adults } = req.query;

    if (!origin || !destination || !departure_date) {
        return response.error(res, "Missing required query parameters: origin, destination, departure_date", 400);
    }

    try {
        const data = await flightService.searchOneWay({
            origin,
            destination,
            departureDate: departure_date,
            adults: adults ? parseInt(adults, 10) : 1,
        });

        response.ok(res, data, "Flights retrieved successfully", 200);
    } catch (error) {
        console.error(error);
        response.error(res, error.message, 500, error.response?.data);
    }
});

module.exports = router;
