const express = require('express');
const router = express.Router();
const Complaint = require('../models/Complaint');
const auth = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../uploads/grievances');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure Multer for attachments (max 5MB)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/grievances/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Submit Complaint
router.post('/submit', upload.single('attachment'), async (req, res) => {
    try {
        let { voterId, message, category, name, email, phone, target } = req.body;
        
        const token = req.header('x-auth-token') || req.cookies?.token;
        if (token) {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                voterId = decoded.user.rollNumber || decoded.user.id;
            } catch (err) { }
        }

        const trackingId = `TKT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        
        let attachmentUrl = null;
        if (req.file) {
            attachmentUrl = '/uploads/grievances/' + req.file.filename;
        }

        const newComplaint = new Complaint({
            trackingId,
            voterId: voterId || null,
            name: name || null,
            email: email || null,
            phone: phone || null,
            category,
            message,
            target: target || 'committee',
            attachmentUrl
        });
        await newComplaint.save();
        
        const logAudit = require('../middleware/auditLog');
        await logAudit(req, 'COMPLAINT_SUBMIT', 'HELPDESK', `New complaint ${trackingId} submitted in category ${category}`);
        res.json({ msg: 'Complaint submitted successfully', trackingId });
    } catch (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ msg: 'File size exceeds the 5MB limit' });
        }
        console.error("Submission Error:", err);
        res.status(500).send('Server error');
    }
});

// Reply to Complaint
router.post('/reply/:id', auth, upload.single('attachment'), async (req, res) => {
    try {
        const { message } = req.body;
        const complaint = await Complaint.findById(req.params.id);
        if (!complaint) return res.status(404).json({ msg: 'Complaint not found' });

        if (complaint.status === 'resolved' || complaint.status === 'dismissed') {
            return res.status(400).json({ msg: 'Cannot reply to a closed ticket' });
        }

        let senderType = 'voter';
        let senderName = req.user.name || 'Voter';
        
        // Determine sender type (voter vs admin/committee)
        if (req.user.role === 'admin') {
            senderType = 'admin';
            senderName = 'Admin (' + req.user.name + ')';
        }
        else if (req.user.role === 'committee') {
            senderType = 'committee';
            senderName = 'Committee (' + req.user.name + ')';
        }
        
        // Validation: Voter cannot reply twice in a row
        if (senderType === 'voter') {
            // Verify ownership
            if (complaint.voterId !== req.user.id && complaint.voterId !== req.user.rollNumber) {
                return res.status(403).json({ msg: 'Unauthorized' });
            }
            const lastReply = complaint.replies.length > 0 ? complaint.replies[complaint.replies.length - 1] : null;
            if (lastReply && lastReply.sender === 'voter') {
                return res.status(400).json({ msg: 'Please wait for the administration to reply before sending another message.' });
            }
            if (!lastReply) {
                return res.status(400).json({ msg: 'Please wait for the administration to analyze your initial ticket before replying.' });
            }
        }

        let attachmentUrl = null;
        if (req.file) {
            attachmentUrl = '/uploads/grievances/' + req.file.filename;
        }

        complaint.replies.push({
            sender: senderType,
            senderName,
            message,
            attachmentUrl
        });

        // Automatically mark as under_review if an admin replies for the first time
        if (senderType !== 'voter' && complaint.status === 'pending') {
            complaint.status = 'under_review';
        }

        await complaint.save();
        
        res.json({ msg: 'Reply sent successfully', complaint });
    } catch (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ msg: 'File size exceeds the 5MB limit' });
        }
        console.error(err);
        res.status(500).send('Server error');
    }
});

// Public Reply to Complaint (Using Tracking ID)
router.post('/public-reply/:trackingId', upload.single('attachment'), async (req, res) => {
    try {
        const { message } = req.body;
        const complaint = await Complaint.findOne({ trackingId: req.params.trackingId.toUpperCase() });
        if (!complaint) return res.status(404).json({ msg: 'Complaint not found' });

        if (complaint.status === 'resolved' || complaint.status === 'dismissed') {
            return res.status(400).json({ msg: 'Cannot reply to a closed ticket' });
        }

        const lastReply = complaint.replies.length > 0 ? complaint.replies[complaint.replies.length - 1] : null;
        if (lastReply && lastReply.sender === 'voter') {
            return res.status(400).json({ msg: 'Please wait for the administration to reply before sending another message.' });
        }
        if (!lastReply) {
            return res.status(400).json({ msg: 'Please wait for the administration to analyze your initial ticket before replying.' });
        }

        let attachmentUrl = null;
        if (req.file) {
            attachmentUrl = '/uploads/grievances/' + req.file.filename;
        }

        complaint.replies.push({
            sender: 'voter',
            senderName: complaint.name || 'Voter',
            message,
            attachmentUrl
        });

        await complaint.save();
        res.json({ msg: 'Reply sent successfully' });
    } catch (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ msg: 'File size exceeds the 5MB limit' });
        }
        console.error("Public Reply Error:", err);
        res.status(500).send('Server error');
    }
});

// Close Ticket Explicitly
router.post('/close/:id', auth, async (req, res) => {
    try {
        const complaint = await Complaint.findById(req.params.id);
        if (!complaint) return res.status(404).json({ msg: 'Complaint not found' });

        let isAuthorized = false;
        if (req.user.role === 'admin' || req.user.role === 'committee') isAuthorized = true;
        if (complaint.voterId === req.user.id || complaint.voterId === req.user.rollNumber) isAuthorized = true;

        if (!isAuthorized) return res.status(403).json({ msg: 'Unauthorized to close this ticket' });

        complaint.status = 'resolved';
        await complaint.save();

        const logAudit = require('../middleware/auditLog');
        await logAudit(req, 'COMPLAINT_CLOSED', 'HELPDESK', `Ticket ${complaint.trackingId} closed manually`);
        
        res.json({ msg: 'Ticket closed successfully' });
    } catch (err) {
        res.status(500).send('Server error');
    }
});

// Admin/Committee Actions (Legacy route updated for status changes without text reply)
router.post('/action/:id', auth, async (req, res) => {
    try {
        const { status } = req.body;
        
        if (!['pending', 'under_review', 'resolved', 'dismissed'].includes(status)) {
            return res.status(400).json({ msg: 'Invalid status' });
        }

        const updatedComplaint = await Complaint.findByIdAndUpdate(req.params.id, {
            status,
            repliedBy: req.user.id
        }, { new: true });
        
        if (!updatedComplaint) return res.status(404).json({ msg: 'Complaint not found' });

        const logAudit = require('../middleware/auditLog');
        await logAudit(req, 'COMPLAINT_ACTION', 'ADMIN', `Complaint ${req.params.id} marked as ${status}`);
        res.json({ msg: `Ticket status updated to ${status.replace('_', ' ')}` });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// Track Complaint by ID (Public)
router.get('/track/:trackingId', async (req, res) => {
    try {
        const complaint = await Complaint.findOne({ trackingId: req.params.trackingId.toUpperCase() })
                                        .populate('repliedBy', 'name');
        if (!complaint) return res.status(404).json({ msg: 'Complaint/Ticket not found' });
        res.json(complaint);
    } catch (err) {
        res.status(500).send('Server error');
    }
});

// Get My Complaints (Authenticated - Priority)
router.get('/my', auth, async (req, res) => {
    try {
        const complaints = await Complaint.find({ 
            $or: [
                { voterId: req.user.id },
                { voterId: req.user.rollNumber }
            ]
        })
        .populate('repliedBy', 'name')
        .sort({ updatedAt: -1, createdAt: -1 });
        res.json(complaints);
    } catch (err) {
        res.status(500).send('Server error');
    }
});

// Get My Complaints (Public/Legacy Fallback)
router.get('/my/:voterId', async (req, res) => {
    try {
        const complaints = await Complaint.find({ voterId: req.params.voterId })
                                        .populate('repliedBy', 'name')
                                        .sort({ timestamp: -1 });
        res.json(complaints);
    } catch (err) {
        res.status(500).send('Server error');
    }
});

// Voter Feedback / Rating Route
router.post('/rate/:id', auth, async (req, res) => {
    try {
        const { rating, feedback } = req.body;
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ msg: 'Valid rating (1-5) is required' });
        }

        const complaint = await Complaint.findById(req.params.id);
        if (!complaint) return res.status(404).json({ msg: 'Complaint not found' });
        
        if (complaint.voterId !== req.user.id && complaint.voterId !== req.user.rollNumber) {
            return res.status(403).json({ msg: 'Unauthorized to rate this ticket' });
        }

        if (complaint.status !== 'resolved' && complaint.status !== 'dismissed') {
            return res.status(400).json({ msg: 'Only closed tickets can be rated' });
        }

        complaint.rating = rating;
        if (feedback) complaint.voterFeedback = feedback;
        await complaint.save();

        res.json({ msg: 'Thank you for your feedback!' });
    } catch (err) {
        res.status(500).send('Server error');
    }
});

// Voter Appeal Action (Escalate to Admin)
router.post('/appeal/:id', auth, async (req, res) => {
    try {
        const { appealMessage } = req.body;
        await Complaint.findByIdAndUpdate(req.params.id, {
            isEscalated: true,
            target: 'admin',
            appealMessage,
            status: 'under_review'
        });

        res.json({ msg: 'Grievance escalated to Admin for review' });
    } catch (err) {
        res.status(500).send('Server error');
    }
});

// Admin View All
router.get('/all', auth, async (req, res) => {
    try {
        const complaints = await Complaint.find()
                                        .populate('repliedBy', 'name')
                                        .sort({ timestamp: -1 });
        res.json(complaints);
    } catch (err) {
        res.status(500).send('Server error');
    }
});

module.exports = router;
