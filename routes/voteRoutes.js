const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Candidate = require('../models/Candidate');
const Vote = require('../models/Vote');
const User = require('../models/User');
const Election = require('../models/Election');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { sendEmail } = require('../services/otpService');

// Cast Vote
router.post('/cast', auth, async (req, res) => {
    try {
        const { candidateId, electionId, type } = req.body;
        const userId = req.user.id;

        const user = await User.findById(userId);
        const election = await Election.findById(electionId);
        const candidate = await Candidate.findById(candidateId);

        if (!candidate || !candidate.isApproved) {
            return res.status(404).json({ msg: 'Candidate not found or not approved' });
        }

        if (!election || election.status !== 'active') {
            return res.status(400).json({ msg: 'This election is not currently active' });
        }

        // Ensure candidate belongs to this election
        if (candidate.electionId !== electionId) {
            return res.status(400).json({ msg: 'Candidate does not belong to this election' });
        }

        // Validate Vote Type & Eligibility (Class-based restrictions)
        if (type === 'class') {
            if (user.hasVotedCRLR) return res.status(400).json({ msg: 'You have already cast your vote for CR/LR' });

            // Check if student belongs to the same class as candidate
            if (candidate.department !== user.department || candidate.year !== user.year) {
                return res.status(403).json({
                    msg: `Ineligible: You belong to ${user.department} (${user.year}), but this candidate is from ${candidate.department} (${candidate.year}).`
                });
            }

            // Optional: Check election scope if defined
            const userClassId = `${user.department}_${user.year}`;
            if (election.scope !== 'global' && election.scope !== userClassId) {
                return res.status(403).json({ msg: `Election Scope Error: You are not eligible for this election scope (${election.scope}).` });
            }
        } else if (type === 'general') {
            if (user.hasVotedGS) return res.status(400).json({ msg: 'You have already cast your vote for GS/DGS' });
        } else {
            return res.status(400).json({ msg: 'Invalid election category' });
        }

        // Check if already voted in this specific election document (extra safety)
        const alreadyVoted = await Vote.findOne({ voterId: userId, electionId: electionId });
        if (alreadyVoted) {
            return res.status(400).json({ msg: 'You have already voted in this specific election' });
        }

        // Create Vote with Blockchain Hash
        const previousVote = await Vote.findOne().sort({ timestamp: -1 });
        const previousHash = previousVote ? previousVote.hash : '0';
        const rawData = `${userId}-${candidateId}-${Date.now()}-${previousHash}`;
        const hash = crypto.createHash('sha256').update(rawData).digest('hex');

        // PREVENT RACE CONDITION: Atomically check if voted and set flag
        const updateField = type === 'class' ? 'hasVotedCRLR' : 'hasVotedGS';
        const updatedUser = await User.findOneAndUpdate(
            { _id: userId, [updateField]: false },
            { $set: { [updateField]: true } },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(400).json({ msg: `You have already cast your vote for ${type === 'class' ? 'CR/LR' : 'GS/GS'}` });
        }

        const newVote = new Vote({
            voterId: userId,
            candidateId,
            electionId,
            previousHash,
            hash
        });

        await newVote.save();

        const logAudit = require('../middleware/auditLog');
        await logAudit(req, 'VOTE_CAST', 'VOTER', `Voted for candidate ${candidateId} in election ${electionId} (Type: ${type})`);

        // Send Confirmation Email (Async)
        const greeting = `Hello ${user.name},\n\nYour vote has been securely recorded on our blockchain-backed ledger for the election: ${election.name}.\n\nThank you for participating in the democratic process!\n\nBest Regards,\neVoter Team`;
        
        sendEmail(user.email, 'Vote Cast Successfully | eVoter', greeting).catch(e => console.error("Vote Email Failed:", e));

        res.json({ msg: 'Your vote has been recorded securely' });

    } catch (err) {
        console.error("Voting Error:", err);
        res.status(500).json({ msg: 'Server error during voting process' });
    }
});

module.exports = router;
