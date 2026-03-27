const mongoose = require('mongoose');

const BiometricRecordSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    descriptorHash: { type: String, required: true }, // Hash of the descriptor array
    timestamp: { type: Date, default: Date.now },
    previousHash: { type: String, required: true },
    hash: { type: String, required: true }
});

module.exports = mongoose.model('BiometricRecord', BiometricRecordSchema);
