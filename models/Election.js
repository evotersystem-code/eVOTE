const mongoose = require('mongoose');

const electionSchema = mongoose.Schema({
    name: { type: String, required: true },
    date: { type: Date, required: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    type: { type: String, required: true, enum: ['class', 'general'] }, // 'class' for CR/LR, 'general' for GS/DGS
    scope: { type: String, default: 'global' }, // Class identifier like 'IT_SY' or 'global'
    status: { type: String, default: 'scheduled', enum: ['scheduled', 'active', 'ended', 'finalized'] }
});

module.exports = mongoose.model('Election', electionSchema);
