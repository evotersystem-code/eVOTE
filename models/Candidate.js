const mongoose = require('mongoose');

const candidateSchema = mongoose.Schema({
    name: { type: String, required: true },
    rollNumber: { type: String }, // Added for better sync
    prn: { type: String }, // Added for better sync
    email: { type: String }, // Added for better sync
    electionId: { type: String, required: true }, // Grouping by election
    position: { type: String, required: true }, // e.g., President, Secretary
    department: { type: String, required: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' }, // Link to Batch for dynamic year
    year: { type: String, required: true }, // Legacy/Snapshot year
    gender: { type: String },
    party: { type: String },
    manifesto: { type: String },
    photo: { type: String },
    address: { type: String },
    addressProof: { type: String },
    voteCount: { type: Number, default: 0 },
    isApproved: { type: Boolean, default: false },
    rejectionReason: { type: String },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    internalNotes: { type: String },
    isWinner: { type: Boolean, default: false },
    formNumber: { type: String, unique: true, sparse: true },
    formCreatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Method to calculate current level (FY/SY/TY/LY) dynamically
candidateSchema.methods.calculateCurrentYear = function(batch) {
    if (!batch && !this.batchId) return this.year || 'N/A';
    const b = batch || this.batchId;
    if (!b || !b.admissionYear) return this.year || 'N/A';

    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth();
    // Academic year starts in June (Month 5)
    const academicYear = curMonth < 5 ? curYear - 1 : curYear;
    const diff = (academicYear - b.admissionYear) + 1;
    
    if (diff <= 0) return 'Future';
    if (diff > (b.courseDuration || 3)) return 'Alumni';
    
    const endYear = (academicYear + 1).toString().slice(-2);
    const session = `${academicYear}-${endYear}`;
    
    const level = ['FY', 'SY', 'TY', 'LY'][diff - 1] || `${diff}thY`;
    return `${level} (${session})`;
};

module.exports = mongoose.model('Candidate', candidateSchema);
