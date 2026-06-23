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

const login = async ({email, password}) => {
    const user = await authRepository.findUserByEmail(email);
    if(!user) {
        throw new Error('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if(!isMatch) {
        throw new Error('Invalid email or password');
    }

    const token = jwt.sign({userId: user.id}, process.env.JWT_SECRET, {expiresIn: '1h'});
    return {token, user: { id: user.id, name: user.name, email: user.email }};
}

module.exports = { register, login };