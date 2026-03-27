const mongoose = require('mongoose');

const noticeSchema = mongoose.Schema({
    title: { type: String, required: true },
    content: { type: String, required: true },
    target: { type: String, enum: ['committee', 'all'], default: 'committee' },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    priority: { type: String, enum: ['normal', 'urgent'], default: 'normal' }
}, { timestamps: true });

module.exports = mongoose.model('Notice', noticeSchema);
