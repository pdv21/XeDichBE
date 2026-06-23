const response = require('../../shared/utils/response');
const authService = require('./auth.service');

const register = async (req, res) => {
    try {
        const {name, email, password, confirmPassword} = req.body;
        const newUser = await authService.register({name, email, password, confirmPassword});
        return response.ok(res, 201, 'User registered successfully', {userId: newUser});
    } catch (error) {
        return response.error(res, error.message, 400);
    }
}

module.exports = { register };