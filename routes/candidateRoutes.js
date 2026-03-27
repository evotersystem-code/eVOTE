const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Candidate = require('../models/Candidate');
const User = require('../models/User');

// Helper to check if user won a class election
async function hasWonClassElection(userId) {
    const Vote = require('../models/Vote');
    const Election = require('../models/Election');

    // Find all ended class elections
    const classElections = await Election.find({ type: 'class', status: 'ended' });

    for (const election of classElections) {
        // Find winner for this election
        const results = await Vote.aggregate([
            { $match: { electionId: election._id.toString() } },
            { $group: { _id: "$candidateId", count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        if (results.length > 0) {
            const winnerId = results[0]._id;
            // Check if this winner is our user
            const Candidate = require('../models/Candidate');
            const candidate = await Candidate.findById(winnerId);
            const User = require('../models/User');
            if (candidate) {
                const user = await User.findOne({ name: candidate.name }); // Match by name since ID might differ between collections
                if (user && user._id.toString() === userId.toString()) return true;
            }
        }
    }
    return false;
}

// Apply as Candidate
router.post('/apply', auth, async (req, res) => {
    try {
        const Election = require('../models/Election');
        const { position, party, manifesto, photo, addressProof } = req.body;
        const user = await User.findById(req.user.id);

        if (!user.isApproved) {
            return res.status(403).json({ msg: 'Your voter account must be approved before you can apply as a candidate' });
        }

        // Check if already applied (pending or approved)
        let existing = await Candidate.findOne({ rollNumber: user.rollNumber, status: { $in: ['pending', 'approved'] } });
        if (existing) return res.status(400).json({ msg: 'You already have an active or pending application' });

        // Check if there's a rejected application to resubmit
        existing = await Candidate.findOne({ rollNumber: user.rollNumber, status: 'rejected' });
        const isResubmit = !!existing;

        const crypto = require('crypto');
        const formNumber = isResubmit ? existing.formNumber : `CAND-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

        // Determine Election Type
        const isGSPosition = ['GS', 'DGS'].includes(position.toUpperCase());
        const electionType = isGSPosition ? 'general' : 'class';

        // GS/DGS Eligibility Check
        if (isGSPosition) {
            if (!user.wonCRLR) {
                return res.status(403).json({
                    msg: 'Eligibility Denied: You can only apply for GS/DGS if you have won a previous CR/LR election.'
                });
            }
        }

        // LR Gender Check
        if (position.toUpperCase() === 'LR') {
            if (user.gender !== 'female') {
                return res.status(403).json({ msg: 'Eligibility Denied: Only female candidates can apply for the LR position.' });
            }
        }

        // Find Active Election
        const activeElection = await Election.findOne({ type: electionType, status: 'active' });
        if (!activeElection) {
            return res.status(400).json({ msg: `No active ${electionType} election found. Please contact admin.` });
        }

        if (isResubmit) {
            existing.position = position;
            existing.party = party;
            existing.manifesto = manifesto;
            existing.photo = photo;
            existing.addressProof = addressProof || user.addressProof;
            existing.status = 'pending';
            existing.rejectionReason = null;
            existing.prn = user.prn;
            existing.batchId = user.batchId;
            existing.electionId = activeElection._id.toString(); // Update to latest active election
            existing.formCreatedAt = Date.now();
            await existing.save();
        } else {
            const newCandidate = new Candidate({
                name: user.name,
                rollNumber: user.rollNumber,
                prn: user.prn,
                email: user.email,
                electionId: activeElection._id.toString(),
                position,
                department: user.department,
                batchId: user.batchId,
                year: user.year,
                gender: user.gender,
                party,
                manifesto,
                photo,
                address: user.address,
                addressProof: addressProof || user.addressProof,
                isApproved: false,
                status: 'pending',
                formNumber,
                formCreatedAt: Date.now()
            });
            await newCandidate.save();
        }

        const logAudit = require('../middleware/auditLog');
        await logAudit(req, 'CANDIDATE_APPLY', 'CANDIDATE', `User applied for ${position} in election ${activeElection._id}`);

        res.status(isResubmit ? 200 : 201).json({ 
            msg: isResubmit ? 'Application resubmitted successfully' : 'Application submitted successfully.', 
            formNumber 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// Get all approved candidates (Public - only for active elections)
router.get('/approved', async (req, res) => {
    try {
        const Election = require('../models/Election');
        const activeElections = await Election.find({ status: 'active' }).select('_id');
        const activeElectionIds = activeElections.map(e => e._id.toString());

        const candidates = await Candidate.find({ 
            isApproved: true,
            electionId: { $in: activeElectionIds }
        }).populate('batchId');

        // Enrich approved candidates
        const enriched = await Promise.all(candidates.map(async (c) => {
            // Dynamic year calculation for candidate
            if (c.batchId) {
                c.year = c.calculateCurrentYear();
            }
            let query = {};
            if (c.rollNumber) {
                query = { rollNumber: c.rollNumber };
            } else {
                const escapedName = c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                query = { name: { $regex: new RegExp(`^${escapedName}$`, 'i') } };
            }

            const user = await User.findOne(query).select('faceData rollNumber email department year batchId').populate('batchId');

            // Dynamic year calculation from user if candidate's is missing
            let dynamicYear = c.year;
            if (!c.batchId && user && user.batchId) {
                // If the candidate doesn't have batchId but user does, use user's
                const uDoc = await User.findOne(query).populate('batchId'); // Get doc to use methods
                if (uDoc) dynamicYear = uDoc.calculateCurrentYear();
            }

            return {
                ...c.toObject(),
                faceData: user ? user.faceData : null,
                rollNumber: c.rollNumber || (user ? user.rollNumber : 'N/A'),
                email: c.email || (user ? user.email : 'N/A'),
                department: c.department || (user ? user.department : 'General'),
                year: dynamicYear || (user ? user.year : (c.year || 'N/A'))
            };
        }));

        res.json(enriched);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// Get My Candidacy Status
router.get('/me', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const candidate = await Candidate.findOne({ name: user.name });
        res.json(candidate || null);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// Get all candidates (Admin/Committee only)
router.get('/all', auth, async (req, res) => {
    try {
        if (req.user.role === 'voter') {
            return res.status(403).json({ msg: 'Access denied' });
        }
        const candidates = await Candidate.find().lean();

        // Enrich with user data (rollNumber, faceData, email)
        const enriched = await Promise.all(candidates.map(async (c) => {
            let query = {};
            if (c.rollNumber) {
                query = { rollNumber: c.rollNumber };
            } else {
                const escapedName = c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                query = { name: { $regex: new RegExp(`^${escapedName}$`, 'i') } };
            }

            const user = await User.findOne(query).select('faceData rollNumber email department year').lean();

            return {
                ...c,
                faceData: user ? user.faceData : null,
                rollNumber: c.rollNumber || (user ? user.rollNumber : 'N/A'),
                email: c.email || (user ? user.email : 'N/A'),
                department: c.department || (user ? user.department : 'General'),
                year: c.year || (user ? user.year : 'N/A')
            };
        }));

        res.json(enriched);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// Check GS Eligibility (Public endpoint for candidate dashboard)
router.get('/check-gs-eligibility', auth, async (req, res) => {
    try {
        const isEligible = await hasWonClassElection(req.user.id);
        res.json({ isEligible });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// Approve/Reject Candidate
router.post('/approve/:id', auth, async (req, res) => {
    try {
        if (req.user.role === 'voter') {
            return res.status(403).json({ msg: 'Access denied' });
        }
        const { status, reason } = req.body; // 'approve' or 'reject'

        if (status === 'approve') {
            await Candidate.findByIdAndUpdate(req.params.id, {
                isApproved: true,
                status: 'approved',
                approvedBy: req.user.id,
                rejectedBy: null,
                rejectionReason: null
            });
            const logAudit = require('../middleware/auditLog');
            await logAudit(req, 'APPROVE_CANDIDATE', 'CANDIDATE', `Approved candidate with ID: ${req.params.id}`);
            res.json({ msg: 'Candidate approved' });
        } else {
            const candidate = await Candidate.findById(req.params.id);
            if (!candidate) return res.status(404).json({ msg: 'Candidate not found' });

            await Candidate.findByIdAndUpdate(req.params.id, {
                isApproved: false,
                status: 'rejected',
                rejectedBy: req.user.id,
                approvedBy: null,
                rejectionReason: reason || 'Requirements not met'
            });

            const logAudit = require('../middleware/auditLog');
            await logAudit(req, 'REJECT_CANDIDATE', 'CANDIDATE', `Candidate ${req.params.id} rejected. Reason: ${reason}`);

            // Send Email Notification
            try {
                const subject = `Electoral Commission: Candidate Application ${status === 'reject' ? 'Rejected' : 'Removed'}`;
                const text = `Hello ${candidate.name},\n\nYour application for the position of ${candidate.position} has been ${status === 'reject' ? 'rejected' : 'removed by the commission'}.\n\nReason: ${reason || 'Requirements not met'}\n\nPlease contact the electoral panel if you have any questions.`;
                const { sendEmail } = require('../services/otpService');
                await sendEmail(candidate.email, subject, text);
            } catch (emailErr) {
                console.error("Failed to send candidate rejection email:", emailErr.message);
            }

            res.json({ msg: `Candidate ${status === 'reject' ? 'rejected' : 'removed'}` });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// @route   GET api/candidates/detail/:id
// @desc    Get candidate details with user profile
// @access  Private/Admin
router.get('/detail/:id', auth, async (req, res) => {
    try {
        const candidate = await Candidate.findById(req.params.id)
            .populate('approvedBy', 'name')
            .populate('rejectedBy', 'name')
            .lean();
        if (!candidate) return res.status(404).json({ msg: 'Candidate not found' });

        // Find associated user by rollNumber or name (case-insensitive fallback)
        let query = {};
        if (candidate.rollNumber) {
            query = { rollNumber: candidate.rollNumber };
        } else {
            // Case-insensitive exact match for legacy data
            const escapedName = candidate.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            query = { name: { $regex: new RegExp(`^${escapedName}$`, 'i') } };
        }

        const user = await User.findOne(query).select('-password').lean();

        // Merge user data into candidate object for detail view
        const detailView = {
            ...candidate,
            faceData: user ? user.faceData : null,
            rollNumber: candidate.rollNumber || (user ? user.rollNumber : 'N/A'),
            email: candidate.email || (user ? user.email : 'N/A'),
            department: candidate.department || (user ? user.department : 'General'),
            year: candidate.year || (user ? user.year : 'N/A')
        };

        res.json(detailView);
    } catch (err) {
        console.error("Detail fetch error:", err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/candidates/all
// @desc    Clear all candidate records
// @access  Private/Admin
router.delete('/all', auth, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ msg: 'Access denied. Admin only.' });
        }
        await Candidate.deleteMany({});
        const logAudit = require('../middleware/auditLog');
        await logAudit(req, 'CANDIDATES_CLEARED', 'ADMIN', `All candidate records were deleted.`);
        res.json({ msg: 'All candidate records have been cleared from the database.' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// Save Candidate Internal Notes
router.post('/save-notes/:id', auth, async (req, res) => {
    try {
        if (req.user.role === 'voter') return res.status(403).json({ msg: 'Access denied' });
        const { notes } = req.body;
        await Candidate.findByIdAndUpdate(req.params.id, { internalNotes: notes });
        res.json({ msg: 'Internal notes saved.' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

module.exports = router;
