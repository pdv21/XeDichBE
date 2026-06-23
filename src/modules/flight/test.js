const axios = require("axios");
const express = require("express");
const router = express.Router();
const response = require("../../shared/utils/response");

const searchFlights = async () => {
    const response = await axios.post(
        "https://ignav.com/api/fares/one-way",
        {
            origin: "HAN",
            destination: "SGN",
            departure_date: "2026-07-01",
            adults: 1
        },
        {
            headers: {
                "X-Api-Key": process.env.IGNAV_API_KEY,
                "Content-Type": "application/json"
            }
        }
    );

    return response.data;
};

router.get("/flights", async (req, res) => {
    try {
        const data = await searchFlights();

        response.ok(res, data, "Flights retrieved successfully", 200);
    } catch (error) {
    console.error(error);

    response.error(res, 500, error.message, error.response?.data);
}
});

module.exports = router;