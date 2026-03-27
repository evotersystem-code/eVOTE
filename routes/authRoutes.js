const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');
const BiometricRecord = require('../models/BiometricRecord');
const crypto = require('crypto');
const { sendWhatsAppOTP, sendEmailOTP, verifyOTP, client } = require('../services/otpService');
const AuditLog = require('../models/AuditLog');
console.log("[DEBUG] authRoutes.js loading...");
const logAudit = require('../middleware/auditLog');


// @route   POST api/auth/send-otp
// @desc    Send OTP via WhatsApp or Email
// @access  Public
// Debug WhatsApp Status
router.get('/whatsapp-status', async (req, res) => {
    try {
        const state = await client.getState().catch(() => 'DISCONNECTED');
        const info = client.info || 'No Info';
        res.json({ state, info });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Test WhatsApp Send
router.post('/test-whatsapp-send', async (req, res) => {
    const { phone } = req.body;
    try {
        const code = await sendWhatsAppOTP('debug-test', phone);
        res.json({ msg: 'Message sent', code });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/send-otp', async (req, res) => {
    console.log(`[OTP] Request: /send-otp, Body:`, req.body);
    try {
        const { identifier, type } = req.body; // type: 'email' or 'whatsapp'
        if (!identifier || !type) return res.status(400).json({ msg: 'Identifier and type required' });

        if (type === 'email') {
            await sendEmailOTP(identifier);
        } else if (type === 'whatsapp') {
            // Check if identifier is an email (lookup user) or a phone number (direct send)
            const isEmail = identifier.includes('@');
            
            if (isEmail) {
                const user = await User.findOne({ email: identifier });
                if (!user) return res.status(404).json({ msg: 'User not found' });
                if (!user.phone) return res.status(400).json({ msg: 'No WhatsApp number registered for this user' });
                await sendWhatsAppOTP(identifier, user.phone);
            } else {
                // Assume identifier is the phone number itself (used in registration)
                await sendWhatsAppOTP(identifier, identifier);
            }
        } else {
            return res.status(400).json({ msg: 'Invalid OTP type' });
        }

        res.json({ msg: 'OTP sent successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Failed to send OTP', error: err.message });
    }
});

// @route   POST api/auth/verify-otp
// @desc    Verify OTP
// @access  Public
router.post('/verify-otp', async (req, res) => {
    console.log(`[OTP] Request: /verify-otp, Body:`, req.body);
    try {
        const { identifier, code } = req.body;
        if (!identifier || !code) return res.status(400).json({ msg: 'Identifier and code required' });

        const isVerified = await verifyOTP(identifier, code);
        if (isVerified) {
            res.json({ msg: 'OTP verified successfully', verified: true });
        } else {
            res.status(400).json({ msg: 'Invalid or expired OTP', verified: false });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Verification failed' });
    }
});

// Helper for Biometric Blockchain
async function addToBiometricChain(userId, descriptor) {
    const descriptorString = JSON.stringify(descriptor);
    const descriptorHash = crypto.createHash('sha256').update(descriptorString).digest('hex');

    const lastRecord = await BiometricRecord.findOne().sort({ timestamp: -1 });
    const previousHash = lastRecord ? lastRecord.hash : '0';

    const rawData = `${userId}-${descriptorHash}-${Date.now()}-${previousHash}`;
    const hash = crypto.createHash('sha256').update(rawData).digest('hex');

    const newRecord = new BiometricRecord({
        userId,
        descriptorHash,
        previousHash,
        hash
    });

    await newRecord.save();
    return hash;
}

// Helper for Euclidean Distance
function getFaceDistance(desc1, desc2) {
    if (!desc1 || !desc2 || desc1.length !== desc2.length) return Infinity;
    return Math.sqrt(desc1.reduce((sum, val, i) => sum + Math.pow(val - desc2[i], 2), 0));
}

// Register
router.post('/register', async (req, res) => {
    try {
        const { name, email, phone, password, dob, rollNumber, prn, batchId, gender, address, addressProof, faceData, faceDescriptor, profilePhoto } = req.body;

        // SERVER-SIDE VALIDATION
        if (!name || !email || !password || !dob || !rollNumber || !prn) {
            return res.status(400).json({ msg: 'Please provide all required fields including PRN' });
        }

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ msg: 'Invalid email format' });
        }

        // Roll number format (assuming alphanumeric, min 3 chars)
        if (rollNumber.length < 3) {
            return res.status(400).json({ msg: 'Invalid roll number format' });
        }

        // PRN format check (must be exactly 16 digits)
        const prnRegex = /^\d{16}$/;
        if (!prnRegex.test(prn)) {
            return res.status(400).json({ msg: 'PRN must be exactly 16 digits' });
        }

        // Password complexity check
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[@$!%*?&])[A-Za-z0-9@$!%*?&]{8,}$/;
        if (!passwordRegex.test(password)) {
            return res.status(400).json({ msg: 'Password must be at least 8 characters and contain uppercase, lowercase, number, and special character' });
        }

        // Check for name or birth year in password
        if (password.toLowerCase().includes(name.toLowerCase())) {
            return res.status(400).json({ msg: 'Password should not contain your name' });
        }

        const birthYear = new Date(dob).getFullYear().toString();
        if (password.includes(birthYear)) {
            return res.status(400).json({ msg: 'Password should not contain your birth year' });
        }

        // Registration is for 'voter' role (default). Check uniqueness within that role only.
        // We look up by email, rollNumber, or prn to catch resubmissions and duplicates correctly.
        let userByEmail = await User.findOne({ email: email, role: 'voter' });
        if (userByEmail && userByEmail.status !== 'rejected') {
            return res.status(400).json({ msg: `A voter account with this email already exists.` });
        }

        let userByRoll = await User.findOne({ rollNumber: rollNumber, role: 'voter' });
        if (userByRoll && userByRoll.status !== 'rejected') {
            return res.status(400).json({ msg: `This roll number is already used. Check roll no if roll no is incorrect.` });
        }

        let userByPRN = await User.findOne({ prn: prn, role: 'voter' });
        if (userByPRN && userByPRN.status !== 'rejected') {
            return res.status(400).json({ msg: `This PRN is already used. Check your PRN if PRN is incorrect.` });
        }

        // For resubmissions, we use the original logic but check if they are the same person
        let user = userByEmail || userByRoll || userByPRN;
        const isResubmit = user && user.status === 'rejected';

        if (!isResubmit && phone) {
            const phoneExists = await User.findOne({ phone, role: 'voter' });
            if (phoneExists) return res.status(400).json({ msg: 'A voter account with this phone number already exists.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Check if this is the first user
        const isFirstUser = !isResubmit && (await User.countDocuments({})) === 0;

        const formNumber = isResubmit ? user.formNumber : `REG-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

        if (isResubmit) {
            // Log the old data for audit before overwriting
            const oldData = {
                name: user.name,
                email: user.email,
                phone: user.phone,
                rollNumber: user.rollNumber,
                prn: user.prn,
                department: user.department,
                year: user.year,
                address: user.address,
                rejectionReason: user.rejectionReason,
                formCreatedAt: user.formCreatedAt
            };

            // Fetch batch to get department
            const Class = require('../models/Class');
            const batch = await Class.findById(batchId);
            if (!batch) return res.status(400).json({ msg: 'Invalid Batch selected' });

            user.batchId = batchId;
            user.department = batch.department;
            user.year = user.calculateCurrentYear(batch);
            user.gender = gender;
            user.address = address;
            user.addressProof = addressProof;
            user.faceData = faceData;
            user.profilePhoto = profilePhoto;
            user.faceDescriptor = faceDescriptor;
            user.status = 'pending';
            user.rejectionReason = null;
            user.formCreatedAt = Date.now();

            await user.save();
            const logAudit = require('../middleware/auditLog');
            const auditMsg = `User ${email} resubmitted application. Old Data: ${JSON.stringify(oldData)}`;
            await logAudit(req, 'USER_RESUBMITTED', 'AUTH', auditMsg);
        } else {
            // Fetch batch to get department
            const Class = require('../models/Class');
            const batch = await Class.findById(batchId);
            if (!batch) return res.status(400).json({ msg: 'Invalid Batch selected' });

            // Calculate current level (FY/SY/TY) for compatibility
            const calculateLevel = (admitYear, duration) => {
                const now = new Date();
                const curYear = now.getFullYear();
                const curMonth = now.getMonth();
                const academicYear = curMonth < 5 ? curYear - 1 : curYear;
                const diff = (academicYear - admitYear) + 1;
                return (['FY', 'SY', 'TY', 'LY'][diff-1] || `${diff}thY`);
            };

            user = new User({
                name,
                email,
                phone,
                password: hashedPassword,
                dob: new Date(dob),
                rollNumber,
                prn,
                batchId,
                department: batch.department,
                year: calculateLevel(batch.admissionYear, batch.courseDuration),
                gender,
                address,
                addressProof,
                faceData,
                profilePhoto,
                faceDescriptor,
                role: isFirstUser ? 'admin' : 'voter',
                isApproved: isFirstUser ? true : false,
                status: isFirstUser ? 'approved' : 'pending',
                formNumber,
                formCreatedAt: Date.now()
            });
            await user.save();
            const logAudit = require('../middleware/auditLog');
            await logAudit(req, 'USER_REGISTERED', 'AUTH', `User ${email} registered with role ${isFirstUser ? 'admin' : 'voter'}. Status: ${user.status}`);
        }

        // Send Registration Confirmation Email
        // We don't await this so the user gets an immediate response
        const { sendEmail } = require('../services/otpService');
        const subject = `eVoter Registration Received: ${user.formNumber}`;
        const text = `Hello ${user.name},\n\nYour voter registration has been successfully received.\n\n` +
            `--- APPLICATION DETAILS ---\n` +
            `Tracking Number: ${user.formNumber}\n` +
            `Full Name: ${user.name}\n` +
            `Roll Number: ${user.rollNumber}\n` +
            `Department: ${user.department}\n` +
            `Year: ${user.year}\n` +
            `Email: ${user.email}\n` +
            `Phone: ${user.phone}\n\n` +
            `--- STATUS ---\n` +
            `Current Status: ${user.status.toUpperCase()}\n\n` +
            `You can track your application status at any time using the link below:\n` +
            `${req.protocol}://${req.get('host')}/track?num=${user.formNumber}\n\n` +
            `Please save this email for your records.`;
        
        sendEmail(user.email, subject, text).catch(err => {
            console.error("Async registration email failed:", err.message);
        });

        res.status(201).json({
            msg: 'Registration successful!',
            formNumber: user.formNumber,
            status: user.status
        });

    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// Login
router.post('/login', async (req, res) => {
    console.log("[DEBUG] /login route hit!");
    try {
        const { email, password, role, faceDescriptor } = req.body;
        
        const user = await User.findOne({ 
            $or: [{ email: email }, { rollNumber: email }], 
            role 
        });

        const { logActivity } = require('../utils/logger');

        if (!user) {
            await logActivity({ action: 'LOGIN_FAILURE', resource: 'AUTH', details: `User not found: ${email}`, status: 'failure' }, req);
            return res.status(400).json({ msg: 'Invalid credentials' });
        }

        // --- Account Lockdown Check ---
        if (user.lockUntil && user.lockUntil > Date.now()) {
            const waitTime = Math.ceil((user.lockUntil - Date.now()) / (60 * 1000));
            return res.status(403).json({ msg: `Account is temporarily locked. Please try again in ${waitTime} minutes.` });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            user.loginAttempts = (user.loginAttempts || 0) + 1;
            if (user.loginAttempts >= 5) {
                user.lockUntil = Date.now() + 2 * 60 * 1000; // 2 minutes
            }
            try { await user.save(); } catch(e) { console.error("Failed to save login attempts:", e.message); }
            return res.status(400).json({ msg: 'Invalid credentials' });
        }

        // Adaptive Face Verification
        if (!faceDescriptor) {
            return res.status(400).json({ msg: 'Biometric data required' });
        }

        if (user.faceDescriptor && user.faceDescriptor.length > 0) {
            const distance = getFaceDistance(user.faceDescriptor, faceDescriptor);
            const STRICT_THRESHOLD = 0.55;
            const LOOSE_THRESHOLD = 0.68;

            console.log(`[AUTH] Biometric distance for ${user.email}: ${distance.toFixed(4)}`);

            if (distance > LOOSE_THRESHOLD) {
                user.loginAttempts = (user.loginAttempts || 0) + 1;
                if (user.loginAttempts >= 5) {
                    user.lockUntil = Date.now() + 2 * 60 * 1000; // 2 minutes
                }
                await user.save().catch(e => console.error("Face failure save failed:", e.message));
                
                await logActivity({ userId: user._id, action: 'LOGIN_FACE_FAILURE', resource: 'AUTH', details: `Face mismatch distance: ${distance}`, status: 'failure' }, req);
                return res.status(401).json({ msg: 'Face verification failed! Face does not match registered pattern.' });
            }

            // --- IDENTITY VERIFIED ---
            // If we reach here, face is verified (perfectly or borderline).
            // We return 200 OK so the frontend can then show the choice modal OR proceed (if otpCode already provided)
            const { otpCode } = req.body;
            
            if (otpCode) {
                // Final Verification Stage (after user has chosen method and received OTP)
                const isVerified = await verifyOTP(user.email, otpCode);
                if (!isVerified) {
                    await logActivity({ userId: user._id, action: 'LOGIN_OTP_FAILURE', resource: 'AUTH', details: 'Invalid OTP for 2FA', status: 'failure' }, req);
                    return res.status(401).json({ msg: 'Invalid verification OTP. Access denied.' });
                }
                await logActivity({ userId: user._id, action: 'LOGIN_IDENTITY_VERIFIED', resource: 'AUTH', details: `Face & OTP Verified. Distance: ${distance.toFixed(3)}` }, req);
            } else {
                // Identity verified via face, but needs second factor
                return res.status(200).json({ msg: 'Identity verified. Please complete 2FA.', faceVerified: true, distance });
            }
        } else {
            // New user enrollment logic (if descriptor missing)
            user.faceDescriptor = faceDescriptor;
            if (req.body.faceData) user.faceData = req.body.faceData;
            try { 
                await user.save(); 
                await addToBiometricChain(user.id, faceDescriptor);
            } catch(e) { console.error("Enrollment save failed:", e.message); }
        }

        user.loginAttempts = 0;
        user.lockUntil = undefined;
        user.lastSeen = Date.now();
        try { await user.save(); } catch(e) { console.error("Heartbeat save failed:", e.message); }

        const payload = {
            user: {
                id: user.id,
                role: user.role,
                name: user.name,
                rollNumber: user.rollNumber
            }
        };

        const jwt = require('jsonwebtoken');
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production', 
            sameSite: 'Strict',
            maxAge: 60 * 60 * 1000
        });

        const needsPrnUpdate = user.role === 'voter' && !user.prn;

        res.json({ 
            role: user.role, 
            mustChangePassword: user.mustChangePassword || false,
            needsPrnUpdate: needsPrnUpdate
        });

    } catch (err) {
        console.error('Login Error:', err);
        res.status(500).json({ msg: 'Server error during login', error: err.message });
    }
});

// @route   POST /api/auth/logout
// @desc    Logout user & blacklist token
// @access  Private
router.post('/logout', auth, async (req, res) => {
    try {
        const token = req.cookies.token;
        if (token) {
            const jwt = require('jsonwebtoken');
            const BlacklistedToken = require('../models/BlacklistedToken');
            const decoded = jwt.decode(token);
            if (decoded && decoded.exp) {
                const expiresAt = new Date(decoded.exp * 1000);
                await BlacklistedToken.create({ token, expiresAt });
            }
            
            const { logActivity } = require('../utils/logger');
            await logActivity({ userId: req.user.id, action: 'LOGOUT', resource: 'AUTH' }, req);
        }

        res.clearCookie('token');
        res.clearCookie('XSRF-TOKEN');
        res.json({ msg: 'Logged out successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error during logout');
    }
});

// @route   GET api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .select('-password')
            .populate('approvedBy', 'name')
            .populate('rejectedBy', 'name')
            .populate('batchId');
        
        if (user && user.role === 'voter' && user.batchId) {
            user.year = user.calculateCurrentYear();
        }
        res.json(user);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Register Staff (Admin only)
router.post('/register-staff', auth, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ msg: 'Only admins can register staff' });
        }

        const { name, email, password, rollNumber, role, phone } = req.body;

        if (role !== 'admin' && role !== 'committee') {
            return res.status(400).json({ msg: 'Invalid role for staff' });
        }

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ msg: 'Invalid email format' });
        }

        // Staff ID (rollNumber) format: 6-digit unique
        const staffIdRegex = /^\d{6}$/;
        if (!staffIdRegex.test(rollNumber)) {
            return res.status(400).json({ msg: 'Staff ID must be exactly 6 unique digits.' });
        }

        // Password complexity check
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[@$!%*?&])[A-Za-z0-9@$!%*?&]{8,}$/;
        if (!passwordRegex.test(password)) {
            return res.status(400).json({ msg: 'Password must be at least 8 characters and contain uppercase, lowercase, number, and special character' });
        }

        if (password.toLowerCase().includes(name.toLowerCase())) {
            return res.status(400).json({ msg: 'Password should not contain your name' });
        }

        // Role-specific check: Only check for existing accounts with the SAME role
        let existingUser = await User.findOne({ email, role });
        if (existingUser) return res.status(400).json({ msg: `A user with this email already exists as a ${role}.` });

        // Uniqueness check for Staff ID (rollNumber) within the SAME role
        let existingId = await User.findOne({ rollNumber, role });
        if (existingId) return res.status(400).json({ msg: `This Staff ID is already assigned to another ${role}.` });

        // Uniqueness check for Phone (Mobile Number) within the SAME role
        if (phone) {
            let existingPhone = await User.findOne({ phone, role });
            if (existingPhone) return res.status(400).json({ msg: `This mobile number is already registered to another ${role}.` });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const user = new User({
            name,
            email,
            password: hashedPassword,
            rollNumber,
            phone,
            role,
            isApproved: true // Staff is pre-approved
        });

        await user.save();
        res.status(201).json({ msg: `${role.charAt(0).toUpperCase() + role.slice(1)} registered successfully.` });

    } catch (err) {
        console.error("Staff Registration Error:", err);
        if (err.code === 11000) {
            const field = Object.keys(err.keyPattern)[0];
            return res.status(400).json({ msg: `A user with this ${field} already exists in the system database.` });
        }
        res.status(500).send('Server error');
    }
});



// Get all voters (Admin/Committee only)
router.get('/voters', auth, async (req, res) => {
    try {
        if (req.user.role === 'voter') {
            return res.status(403).json({ msg: 'Access denied' });
        }
        const voters = await User.find({ role: 'voter' });
        res.json(voters);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// Approve/Reject Voter
router.post('/approve-voter/:id', auth, async (req, res) => {
    try {
        if (req.user.role === 'voter') {
            return res.status(403).json({ msg: 'Access denied' });
        }
        const { status, reason } = req.body; // 'approve' or 'reject'

        if (status === 'approve') {
            const user = await User.findById(req.params.id);
            if (!user) return res.status(404).json({ msg: 'User not found' });

            await User.findByIdAndUpdate(req.params.id, {
                isApproved: true,
                status: 'approved',
                approvedBy: req.user.id, // Attribute approval
                rejectedBy: null,
                rejectionReason: null
            });
            await logAudit(req, 'APPROVE_VOTER', 'VOTER', `Approved voter with ID: ${req.params.id}`);

            // Send Approval Email Asynchronously
            const { sendEmail } = require('../services/otpService');
            const sub = `eVoter Application: APPROVED`;
            const body = `Hello ${user.name},\n\nYour voter application has been APPROVED by the election committee.\n\nYou can now log in to the portal and participate in active elections.\n\nPortal: ${req.protocol}://${req.get('host')}/login`;
            
            sendEmail(user.email, sub, body).catch(err => {
                console.error("Async approval email failed:", err.message);
            });

            res.json({ msg: 'Voter approved' });
        } else {
            const user = await User.findById(req.params.id);
            if (!user) return res.status(404).json({ msg: 'User not found' });

            await User.findByIdAndUpdate(req.params.id, {
                isApproved: false,
                status: 'rejected',
                rejectedBy: req.user.id, // Attribute rejection
                approvedBy: null,
                rejectionReason: reason || 'Requirements not met'
            });

            await logAudit(req, status === 'reject' ? 'REJECT_VOTER' : 'REMOVE_VOTER', 'VOTER', `Status: ${status}, Reason: ${reason || 'N/A'}, Voter: ${user.email}`);

            // Send Rejection Email Asynchronously
            const { sendEmail } = require('../services/otpService');
            const sub = `eVoter Application: ${status === 'reject' ? 'Rejected' : 'Removed'}`;
            const body = `Hello ${user.name},\n\nYour voter application has been ${status === 'reject' ? 'rejected' : 'removed by the admin'}.\n\n` +
                `Reason: ${reason || 'Requirements not met'}\n\n` +
                `If you believe this was an error or you need to correct your details, you can refill the registration form here:\n` +
                `${req.protocol}://${req.get('host')}/register\n\n` +
                `Please contact the election committee if you have any questions.`;
            
            sendEmail(user.email, sub, body).catch(err => {
                console.error("Async rejection email failed:", err.message);
            });

            res.json({ msg: `Voter ${status === 'reject' ? 'rejected' : 'removed'}` });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// @route   POST /api/auth/bulk-approve-voters
// @desc    Bulk approve multiple voters (Admin/Committee)
// @access  Private
router.post('/bulk-approve-voters', auth, async (req, res) => {
    try {
        if (req.user.role === 'voter') return res.status(403).json({ msg: 'Access denied' });
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids)) return res.status(400).json({ msg: 'Invalid IDs' });

        await User.updateMany(
            { _id: { $in: ids } },
            { 
                isApproved: true, 
                status: 'approved', 
                approvedBy: req.user.id,
                rejectedBy: null,
                rejectionReason: null
            }
        );

        const logAudit = require('../middleware/auditLog');
        await logAudit(req, 'BULK_APPROVE_VOTERS', 'VOTER', `Bulk approved ${ids.length} voters.`);

        res.json({ msg: `Bulk approved ${ids.length} voters.` });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// @route   POST /api/auth/bulk-reject-voters
// @desc    Bulk reject multiple voters (Admin/Committee)
// @access  Private
router.post('/bulk-reject-voters', auth, async (req, res) => {
    try {
        if (req.user.role === 'voter') return res.status(403).json({ msg: 'Access denied' });
        const { ids, reason } = req.body;
        if (!ids || !Array.isArray(ids)) return res.status(400).json({ msg: 'Invalid IDs' });

        await User.updateMany(
            { _id: { $in: ids } },
            { 
                isApproved: false, 
                status: 'rejected', 
                rejectedBy: req.user.id,
                approvedBy: null,
                rejectionReason: reason || 'Bulk rejection'
            }
        );

        const logAudit = require('../middleware/auditLog');
        await logAudit(req, 'BULK_REJECT_VOTERS', 'VOTER', `Bulk rejected ${ids.length} voters. Reason: ${reason}`);

        res.json({ msg: `Bulk rejected ${ids.length} voters.` });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// Get specific user profile (Admin/Committee only)
router.get('/profile/:id', auth, async (req, res) => {
    try {
        if (req.user.role === 'voter') {
            return res.status(403).json({ msg: 'Access denied' });
        }
        const user = await User.findById(req.params.id)
            .select('-password')
            .populate('approvedBy', 'name')
            .populate('rejectedBy', 'name');
        if (!user) return res.status(404).json({ msg: 'User not found' });
        res.json(user);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// Update Profile (Self only)
router.put('/profile', auth, async (req, res) => {
    try {
        const { name, email, phone, gender, address, addressProof, faceData, faceDescriptor } = req.body;

        const logAudit = require('../middleware/auditLog');
        await logAudit(req, 'PROFILE_UPDATE_ATTEMPT', 'AUTH', `User ${req.user.id} attempting profile update`);

        // Find user
        let user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        // Update fields (excluding rollNumber)
        if (name) user.name = name;
        if (email) user.email = email;
        if (phone) user.phone = phone;
        if (gender) user.gender = gender;
        if (address) user.address = address;
        if (addressProof) user.addressProof = addressProof;
        if (faceData) user.faceData = faceData;

        // Handle biometric update
        if (faceDescriptor && faceDescriptor.length > 0) {
            user.faceDescriptor = faceDescriptor;
            await addToBiometricChain(user.id, faceDescriptor);
        }

        await user.save();
        res.json({ msg: 'Profile updated successfully', user: { name: user.name, email: user.email, department: user.department, year: user.year, role: user.role } });

    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// @route   GET api/auth/track/:formNumber
// @desc    Track application status
// @access  Public
router.get('/track/:formNumber', async (req, res) => {
    try {
        const user = await User.findOne({ formNumber: req.params.formNumber })
            .populate('approvedBy', 'name')
            .populate('rejectedBy', 'name')
            .populate('batchId');

        if (!user) {
            const Candidate = require('../models/Candidate');
            const candidate = await Candidate.findOne({ formNumber: req.params.formNumber });
            if (!candidate) return res.status(404).json({ msg: 'Application not found' });
            
            return res.json({
                type: 'Candidate',
                name: candidate.name,
                status: candidate.status,
                position: candidate.position,
                rejectionReason: candidate.rejectionReason,
                createdAt: candidate.formCreatedAt
            });
        }

        // Calculate dynamic year for voters
        let displayYear = user.year;
        if (user.role === 'voter' && user.batchId) {
            displayYear = user.calculateCurrentYear();
        }

        res.json({
            type: 'Voter Registration',
            name: user.name,
            status: user.status,
            rejectionReason: user.rejectionReason,
            approvedBy: user.approvedBy ? user.approvedBy.name : null,
            rejectedBy: user.rejectedBy ? user.rejectedBy.name : null,
            createdAt: user.formCreatedAt,
            // Additional fields for printing
            email: user.email,
            phone: user.phone,
            dob: user.dob,
            rollNumber: user.rollNumber,
            prn: user.prn,
            department: user.department,
            year: displayYear,
            gender: user.gender,
            address: user.address,
            profilePhoto: user.profilePhoto
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Tracking failed' });
    }
});

// @route   POST api/auth/get-phone
// @desc    Get user's phone number by email and role (for WhatsApp OTP on login)
// @access  Public
router.post('/get-phone', async (req, res) => {
    try {
        const { email, role } = req.body;
        if (!email) return res.status(400).json({ msg: 'Email or Roll Number required' });
        const user = await User.findOne({ 
            $or: [{ email: email }, { rollNumber: email }], 
            role: role || 'voter' 
        }); // Select all to allow decryption
        if (!user) return res.status(404).json({ msg: 'User not found' });
        
        try {
            if (!user.phone) return res.status(404).json({ msg: 'No phone number registered for this account' });
            res.json({ phone: user.phone });
        } catch (encErr) {
            console.error("Decryption failure for phone number:", encErr);
            res.status(400).json({ 
                msg: 'Security: Data inaccessible due to system-wide encryption update. Please re-register your profile.',
                encryptionError: true 
            });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// @route   POST /api/auth/change-password
// @desc    Force committee member to change password on first login
// @access  Private
router.post('/change-password', auth, async (req, res) => {
    try {
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ msg: 'Password must be at least 8 characters.' });
        }
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        user.mustChangePassword = false;
        await user.save();
        res.json({ msg: 'Password changed successfully.' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// @route   GET /api/auth/committee
// @desc    List all committee members
// @access  Private/Admin
router.get('/committee', auth, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Access denied' });
        const members = await User.find({ role: 'committee' }).select('-password -faceData -faceDescriptor -addressProof').lean();
        res.json(members);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// @route   POST /api/auth/create-committee
// @desc    Admin creates a committee member account
// @access  Private/Admin
router.post('/create-committee', auth, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Access denied' });
        const { name, email, phone, password } = req.body;

        if (!name || !email || !phone || !password) {
            return res.status(400).json({ msg: 'Name, email, phone and password are all required.' });
        }

        // Check if committee account with this email already exists
        const existing = await User.findOne({ email, role: 'committee' });
        if (existing) return res.status(400).json({ msg: 'A committee account with this email already exists.' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const crypto = require('crypto');
        const formNumber = `COM-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

        const member = new User({
            name,
            email,
            phone,
            password: hashedPassword,
            rollNumber: `COM-${Date.now()}`,
            dob: new Date('1990-01-01'),
            role: 'committee',
            isApproved: true,
            status: 'approved',
            mustChangePassword: true, // Must reset on first login
            formNumber,
            formCreatedAt: Date.now()
        });

        await member.save();
        res.status(201).json({ msg: `Committee account created for ${name}.`, formNumber });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// @route   DELETE /api/auth/committee/:id
// @desc    Admin removes a committee member
// @access  Private/Admin
router.delete('/committee/:id', auth, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Access denied' });
        const member = await User.findById(req.params.id);
        if (!member || member.role !== 'committee') {
            return res.status(404).json({ msg: 'Committee member not found' });
        }
        await User.findByIdAndDelete(req.params.id);
        res.json({ msg: `${member.name} has been removed from the committee.` });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// Bulk Voter Import (Admin only)
const multer = require('multer');
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // Limit to 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'), false);
        }
    }
});

router.post('/bulk-import', auth, upload.single('voters'), async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ msg: 'Only admins can perform bulk imports' });
        }

        if (!req.file) return res.status(400).json({ msg: 'Please upload a CSV file' });

        const csvData = req.file.buffer.toString();
        const lines = csvData.split(/\r?\n/).filter(line => line.trim() !== '');
        
        if (lines.length > 501) { // Limit to 500 records at a time
            return res.status(400).json({ msg: 'Please limit imports to 500 students at a time' });
        }

        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const students = lines.slice(1);

        let successCount = 0;
        let skipCount = 0;
        let errors = [];

        // SANITIZATION HELPER
        const sanitize = (str) => {
            if (!str) return '';
            // Prevent Formula Injection: Strip starting =, +, -, @
            let val = str.trim();
            if (['=', '+', '-', '@'].includes(val[0])) {
                val = "'" + val; // Prepend single quote as per OWASP recommendation
            }
            return val.replace(/[<>]/g, ''); // Simple XSS prevention
        };

        for (const line of students) {
            const values = line.split(',').map(v => v.trim());
            if (values.length < headers.length) continue;

            const userData = {};
            headers.forEach((header, index) => {
                userData[header] = sanitize(values[index]);
            });

            try {
                // Validation of essential fields
                if (!userData.email || !userData.email.includes('@')) {
                    errors.push(`Invalid email format: ${userData.email || 'N/A'}`);
                    skipCount++;
                    continue;
                }

                // Check if user exists (now including PRN check)
                const existingUser = await User.findOne({ 
                    $or: [
                        { email: userData.email }, 
                        { rollNumber: userData.rollNumber },
                        { prn: userData.prn }
                    ],
                    role: 'voter'
                });

                if (existingUser) {
                    skipCount++;
                    continue;
                }

                if (!userData.prn) {
                    errors.push(`Missing PRN for: ${userData.email}`);
                    skipCount++;
                    continue;
                }

                // Create user with a temporary password (e.g., RollNumber@2026)
                const salt = await bcrypt.genSalt(10);
                const tempPassword = `${userData.rollNumber}@2026`;
                const hashedPassword = await bcrypt.hash(tempPassword, salt);

                const formNumber = `BULK-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

                const newUser = new User({
                    name: userData.name,
                    email: userData.email,
                    phone: userData.phone,
                    password: hashedPassword,
                    rollNumber: userData.rollNumber,
                    prn: userData.prn,
                    department: userData.department,
                    year: userData.year,
                    role: 'voter',
                    isApproved: false,
                    status: 'pending',
                    formNumber,
                    formCreatedAt: Date.now()
                });

                await newUser.save();
                successCount++;
            } catch (err) {
                console.error('Error importing student:', userData.email, err.message);
                errors.push(`${userData.email}: ${err.message}`);
                skipCount++;
            }
        }

        // Log the bulk import action
        await logAudit(req, 'BULK_IMPORT', 'VOTER', `Imported ${successCount} students successfully.`);

        res.json({ 
            msg: `Import complete. Success: ${successCount}, Skipped/Failed: ${skipCount}`,
            errors: errors.length > 0 ? errors : null
        });

    } catch (err) {
        console.error(err);
        res.status(500).send('Server error during bulk import');
    }
});

// @route   GET /api/auth/committee-stats
// @desc    Get performance stats for all committee members (Admin only)
// @access  Private/Admin
router.get('/committee-stats', auth, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Access denied' });
        
        const Candidate = require('../models/Candidate');
        const committeeMembers = await User.find({ role: 'committee' });
        
        const stats = await Promise.all(committeeMembers.map(async (member) => {
            const voterApprovals = await User.countDocuments({ approvedBy: member._id });
            const voterRejections = await User.countDocuments({ rejectedBy: member._id });
            const candidateApprovals = await Candidate.countDocuments({ approvedBy: member._id });
            const candidateRejections = await Candidate.countDocuments({ rejectedBy: member._id });
            
            return {
                id: member._id,
                name: member.name,
                email: member.email,
                voterApprovals,
                voterRejections,
                candidateApprovals,
                candidateRejections,
                totalActions: voterApprovals + voterRejections + candidateApprovals + candidateRejections
            };
        }));
        
        res.json(stats);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// @route   GET /api/auth/audit-logs
// @desc    Get all audit logs (Admin only)
// @access  Private/Admin
router.get('/audit-logs', auth, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Access denied' });
        const logs = await AuditLog.find().sort({ timestamp: -1 }).limit(100);
        res.json(logs);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// @route   POST /api/auth/broadcast
// @desc    Admin broadcasts a notice to committee
// @access  Private/Admin
router.post('/broadcast', auth, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Access denied' });
        const { title, content, priority } = req.body;
        const Notice = require('../models/Notice');
        
        const notice = new Notice({
            title,
            content,
            priority,
            author: req.user.id
        });
        
        await notice.save();
        
        const logAudit = require('../middleware/auditLog');
        await logAudit(req, 'BROADCAST_NOTICE', 'ADMIN', `Admin broadcasted notice: ${title}`);
        
        res.status(201).json({ msg: 'Notice broadcasted successfully.' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// @route   GET /api/auth/notices
// @desc    Get all notices for staff (Admin/Committee)
// @access  Private
router.get('/notices', auth, async (req, res) => {
    try {
        const Notice = require('../models/Notice');
        const notices = await Notice.find().sort({ createdAt: -1 }).limit(10).populate('author', 'name');
        res.json(notices);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// @route   POST /api/auth/assign-depts/:id
// @desc    Admin assigns departments to a committee member
// @access  Private/Admin
router.post('/assign-depts/:id', auth, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Access denied' });
        const { departments } = req.body;
        if (!Array.isArray(departments)) return res.status(400).json({ msg: 'Invalid departments format' });

        await User.findByIdAndUpdate(req.params.id, { assignedDepts: departments });
        
        const logAudit = require('../middleware/auditLog');
        await logAudit(req, 'ASSIGN_DEPTS', 'ADMIN', `Assigned depts ${departments.join(', ')} to staff ID: ${req.params.id}`);
        
        res.json({ msg: 'Departments assigned successfully.' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// @route   POST /api/auth/update-prn
// @desc    Update PRN for a user (Voter only)
// @access  Private
router.post('/update-prn', auth, async (req, res) => {
    try {
        const { prn } = req.body;
        if (!prn || prn.length < 5) {
            return res.status(400).json({ msg: 'Invalid PRN format. Must be at least 5 characters.' });
        }

        // Check if PRN is already used by another voter
        const existing = await User.findOne({ prn, role: 'voter', _id: { $ne: req.user.id } });
        if (existing) {
            return res.status(400).json({ msg: 'This PRN is already registered to another account.' });
        }

        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        user.prn = prn;
        await user.save();

        const logAudit = require('../middleware/auditLog');
        await logAudit(req, 'PRN_UPDATED', 'AUTH', `User ${user.email} updated PRN.`);

        res.json({ msg: 'PRN updated successfully.', prn: user.prn });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// @route   GET /api/auth/verify-voter/:id
// @desc    Public voter verification for ID Card QR codes
// @access  Public
router.get('/verify-voter/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id).populate('batchId');
        
        if (!user || user.role !== 'voter' || (user.status !== 'approved' && user.status !== 'verified')) {
            return res.status(404).json({ msg: 'Valid voter not found' });
        }

        res.json({
            name: user.name,
            department: user.department,
            year: user.calculateCurrentYear(),
            status: user.status,
            photo: user.profilePhoto || user.faceData,
            rollNumber: user.rollNumber
        });
    } catch (err) {
        console.error("Voter verification error:", err);
        res.status(400).json({ msg: 'Invalid verification token' });
    }
});

module.exports = router;



