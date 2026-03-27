const mongoose = require('mongoose');

const classSchema = new mongoose.Schema({
    department: {
        type: String,
        required: true,
        trim: true
    },
    admissionYear: {
        type: Number,
        required: true
    },
    courseDuration: {
        type: Number,
        default: 3 // Default 3 years for degree
    }
}, { timestamps: true });

// Ensure unique department/admissionYear pairs
classSchema.index({ department: 1, admissionYear: 1 }, { unique: true });

module.exports = mongoose.model('Class', classSchema);
