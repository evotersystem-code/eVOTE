const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false // Null for unauthenticated actions
    },
    userName: { type: String }, // Cache name for quick reading
    action: {
        type: String,
        required: true
    },
    resource: {
        type: String, // e.g., 'AUTH', 'ELECTION', 'VOTER'
        required: true
    },
    details: { type: String },
    status: { type: String, enum: ['success', 'failure', 'warning'], default: 'success' },
    ip: { type: String },
    userAgent: { type: String },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('AuditLog', AuditLogSchema);
