const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
    identifier: { type: String, required: true }, // Email or Phone
    code: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 600 } // Automatically delete after 10 minutes
});

module.exports = mongoose.model('OTP', otpSchema);
