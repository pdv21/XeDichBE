const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const authRepository = require('./auth.repository.js');

const register = async ({name, email, password, confirmPassword}) => {
    const existingUser = await authRepository.findUserByEmail(email);
    if(existingUser) {
        throw new Error('Email already exists');
    }

    if(password !== confirmPassword) {
        throw new Error('Passwords do not match');
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    //Create a new user
    const newUser = await authRepository.createUser({name, email, password: hashedPassword});

    return newUser;
};

module.exports = { register };