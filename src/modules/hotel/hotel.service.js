const xoteloService = require('./xotelo.service');
const hotelRepository = require('./hotel.repository');

const searchHotelsWithPrice = async ({ city, checkIn, checkOut, budget }) => {
    // Step 1: Check if hotels exist in the database for the given city
    const hotelsFromAPI = await xoteloService.searchHotels(city);

    if (!hotelsFromAPI || hotelsFromAPI.length === 0) {
        throw new Error('Không tìm thấy khách sạn nào từ Xotelo API');
    }

    // Step 2: Upsert hotels into the database
    for (const h of hotelsFromAPI) {
        await hotelRepository.upsetHotel({
            hotel_key:   h.key || null,
            name:        h.name || null,
            city:        city,
            address:     h.address || null,
            lat:         h.geo?.latitude || null,
            lng:         h.geo?.longitude  || null,
            star_rating: h.review_summary?.rating || null,
            thumbnail:   h.thumbnail || null,
            description: h.mentions?.join(', ') || null
        });
    }
 
    // Step 3: Get prices for each hotel and filter based on budget
    const results = await Promise.all(
        hotelsFromAPI.map(async(h) => {
            const cached = await hotelRepository.getCachedPrice(h.key, checkIn, checkOut);
            if(cached) {
                return {...h, price: cached.price, provider: cached.provider, fromCache: true};
            }
            try {
                const rates = await xoteloService.getHotelRates(h.key, checkIn, checkOut);
                const bestRate = rates?.rates?.[0];

                if(bestRate) {
                    await hotelRepository.cachePrice(h.key, checkIn, checkOut, bestRate.rate, bestRate.name);
                    return {...h, price: bestRate.rate, provider: bestRate.name, fromCache: false};
                }
                return {...h, price: null, provider: null};
            } catch (error) {
                console.error(`Error fetching rates for hotel ${h.key}:`, error);
                return {...h, price: null, provider: null};
            }
        })
    );

    return results
    .filter(h => h.price !== null)
    .filter(h => !budget || h.price <= budget)
    .sort((a, b) => a.price - b.price);
};

const getHotelDetail = async (hotelKey, checkIn, checkOut) => {
    const cached = await hotelRepository.getCachedPrice(hotelKey, checkIn, checkOut);
 
    if (cached) {
        return { hotel_key: hotelKey, price: cached.price, provider: cached.provider, from_cache: true };
    }
 
    const rates = await xoteloService.getHotelRates(hotelKey, checkIn, checkOut);
 
    if (!rates) {
        throw new Error('Không tìm thấy khách sạn hoặc không có phòng trống');
    }
 
    const bestRate = rates?.rates?.[0];
    if (bestRate) {
        await hotelRepository.cachePrice(
            hotelKey, checkIn, checkOut,
            bestRate.rate, bestRate.name
        );
    }
 
    return { hotel_key: hotelKey, rates: rates?.rates || [] };
};
 
module.exports = { searchHotelsWithPrice, getHotelDetail };

