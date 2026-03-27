const mongoose = require('mongoose');

const complaintSchema = mongoose.Schema({
    trackingId: { type: String, required: true, unique: true },
    voterId: { type: String }, // Optional for non-logged in users
    name: { type: String },    // Name for public complaints
    email: { type: String },   // Email for public complaints
    phone: { type: String },   // Phone for public complaints
    target: { type: String, enum: ['admin', 'committee'], default: 'committee' }, // New: Directed target
    category: { type: String, required: true, enum: ['candidate', 'voter', 'system', 'registration'] },
    message: { type: String, required: true },
    status: { type: String, default: 'pending', enum: ['pending', 'under_review', 'resolved', 'dismissed'] },
    attachmentUrl: { type: String }, // Initial attachment
    replies: [{
        sender: { type: String, enum: ['voter', 'admin', 'committee'] },
        senderName: { type: String },
        message: { type: String, required: true },
        attachmentUrl: { type: String },
        timestamp: { type: Date, default: Date.now }
    }],
    repliedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Who resolved it
    rating: { type: Number, min: 1, max: 5 }, // Voter satisfaction rating
    voterFeedback: { type: String }, // Text feedback from voter
    isEscalated: { type: Boolean, default: false }, // New: Escalate to admin
    appealMessage: { type: String }, // New: Reason for appeal
    timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Complaint', complaintSchema);
