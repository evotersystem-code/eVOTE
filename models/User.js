const mongoose = require('mongoose');

const userSchema = mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    password: { type: String, required: true },
    rollNumber: { type: String, required: true },
    prn: { type: String }, // Permanent Registration Number - Optional for staff & old users
    phone: { type: String }, // For WhatsApp OTP
    department: { type: String }, // e.g., 'IT', 'BCOM'
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' }, // Reference to Batch (Admission Year/Duration)
    year: { type: String }, // Legacy compatibility: Can be used to store calculated level (FY/SY/TY)
    dob: { type: Date }, // Required only for voters during registration
    gender: { type: String, enum: ['male', 'female', 'other'] },
    role: {
        type: String,
        default: 'voter',
        enum: ['voter', 'admin', 'committee', 'candidate_cr', 'candidate_lr', 'candidate_gs', 'candidate_dgs']
    },
    faceData: { type: String }, // Biometric Capture (Sync with liveness)
    profilePhoto: { type: String }, // High-quality Passport Upload for ID Card
    faceDescriptor: { type: [Number] },
    address: { type: String },
    addressProof: { type: String }, // Base64 of document
    isApproved: { type: Boolean, default: false },
    status: { type: String, enum: ['pending', 'verified', 'approved', 'rejected'], default: 'pending' },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectionReason: { type: String },
    hasVotedCRLR: { type: Boolean, default: false },
    hasVotedGS: { type: Boolean, default: false },
    wonCRLR: { type: Boolean, default: false },
    mustChangePassword: { type: Boolean, default: false }, // Forces password reset on first login
    assignedDepts: { type: [String], default: [] }, // For committee delegation
    formNumber: { type: String, unique: true, sparse: true },
    formCreatedAt: { type: Date, default: Date.now },
    loginAttempts: { type: Number, required: true, default: 0 },
    lockUntil: { type: Number },
    lastSeen: { type: Date, default: Date.now }
}, { timestamps: true });

// Method to calculate current level (FY/SY/TY/LY) dynamically
userSchema.methods.calculateCurrentYear = function(batch) {
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

// Add mongoose-encryption for PII
const encrypt = require('mongoose-encryption');

const encKey = process.env.DB_ENCRYPTION_KEY; 
const sigKey = process.env.DB_SIGNING_KEY;
if (!encKey || !sigKey) {
    console.warn("⚠️ Warning: Database encryption keys are missing. Data security is NOT guaranteed. Configure DB_ENCRYPTION_KEY and DB_SIGNING_KEY in .env.");
}

userSchema.plugin(encrypt, { 
    encryptionKey: encKey, 
    signingKey: sigKey, 
    encryptedFields: ['phone', 'address', 'dob', 'name', 'rollNumber', 'prn', 'profilePhoto'],
    requireAuthenticationCode: false
});

module.exports = mongoose.model('User', userSchema);
