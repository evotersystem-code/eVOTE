const express = require('express');
const router = express.Router();
const Election = require('../models/Election');
const auth = require('../middleware/auth');
const logAudit = require('../middleware/auditLog');
const { sendEmail } = require('../services/otpService');
const User = require('../models/User');

// @route   POST /api/elections
// @desc    Create a new election
// @access  Private/Admin
router.post('/', auth, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ msg: 'Access denied. Admin only.' });
        }

        const { name, date, startTime, endTime, type, scope } = req.body;

        const newElection = new Election({
            name,
            date,
            startTime,
            endTime,
            type,
            scope: scope || 'global',
            status: 'scheduled'
        });

        const election = await newElection.save();
        await logAudit(req, 'CREATE_ELECTION', 'ELECTION', `Created election: ${name}`);
        res.json(election);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/elections
// @desc    Get all elections
// @access  Public
router.get('/', async (req, res) => {
    console.log("[DEBUG] GET /api/elections hit!");
    try {
        const elections = await Election.find().sort({ date: -1 });
        console.log(`[DEBUG] Found ${elections.length} elections.`);
        res.json(elections);
    } catch (err) {
        console.error("[ERROR] GET /api/elections:", err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/elections/public-stats
// @desc    Get public stats for the landing page
// @access  Public
router.get('/public-stats', async (req, res) => {
    try {
        const User = require('../models/User');
        // Require Vote here to avoid circular dependency issues at the top if any
        const Vote = require('../models/Vote');

        const totalVoters = await User.countDocuments({ role: 'voter', isApproved: true });
        const activeContests = await Election.countDocuments({ status: { $in: ['active', 'scheduled'] } });
        
        let avgParticipation = 0;
        if (totalVoters > 0) {
            const uniqueVoters = await Vote.distinct('voterId');
            avgParticipation = Math.min(100, Math.round((uniqueVoters.length / totalVoters) * 100));
        }

        res.json({
            voters: totalVoters,
            participation: avgParticipation,
            contests: activeContests
        });
    } catch (err) {
        console.error("Public Stats Error:", err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PATCH /api/elections/status/:id
// @desc    Update election status
// @access  Private/Admin
router.patch('/status/:id', auth, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ msg: 'Access denied. Admin only.' });
        }

        const { status } = req.body;
        if (!['scheduled', 'active', 'ended'].includes(status)) {
            return res.status(400).json({ msg: 'Invalid status' });
        }

        let election = await Election.findById(req.params.id);
        if (!election) return res.status(404).json({ msg: 'Election not found' });

        const oldStatus = election.status;
        election.status = status;
        await election.save();

        await logAudit(req, 'UPDATE_ELECTION_STATUS', 'ELECTION', `Changed status of "${election.name}" from ${oldStatus} to ${status}`);

        // Automated Alerts: Notify voters when election starts
        if (status === 'active') {
            const voters = await User.find({ role: 'voter', isApproved: true }).select('email');
            const subject = `🗳️ Election Active: ${election.name}`;
            const text = `The election "${election.name}" is now LIVE! Please visit the portal and cast your vote before the deadline.`;
            
            voters.forEach(v => {
                sendEmail(v.email, subject, text).catch(e => console.error(`Failed to notify ${v.email}:`, e.message));
            });
        }

        res.json(election);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/elections/:id
// @desc    Delete an election
// @access  Private/Admin
router.delete('/:id', auth, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ msg: 'Access denied. Admin only.' });
        }

        let election = await Election.findById(req.params.id);
        if (!election) return res.status(404).json({ msg: 'Election not found' });

        await Election.findByIdAndDelete(req.params.id);
        await logAudit(req, 'DELETE_ELECTION', 'ELECTION', `Deleted election: ${election.name}`);
        res.json({ msg: 'Election removed' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/elections/finalize/:id
// @desc    Calculate winners and update user status (CR/LR wins)
// @access  Private/Admin
router.post('/finalize/:id', auth, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ msg: 'Access denied. Admin only.' });
        }

        const election = await Election.findById(req.params.id);
        if (!election) return res.status(404).json({ msg: 'Election not found' });
        if (election.status !== 'ended') return res.status(400).json({ msg: 'Only ended elections can be finalized' });

        const Vote = require('../models/Vote');
        const Candidate = require('../models/Candidate');

        const results = await Vote.aggregate([
            { $match: { electionId: election._id.toString() } },
            { $group: { _id: "$candidateId", count: { $sum: 1 } } }
        ]);

        const candidates = await Candidate.find({ electionId: election._id.toString() });
        const positions = [...new Set(candidates.map(c => c.position))];

        for (const pos of positions) {
            const posCandidates = candidates.filter(c => c.position === pos);
            const winnerData = results
                .filter(r => posCandidates.some(pc => pc._id.toString() === r._id.toString()))
                .sort((a, b) => b.count - a.count)[0];

            if (winnerData) {
                const winner = posCandidates.find(c => c._id.toString() === winnerData._id.toString());
                if (winner) {
                    winner.isWinner = true;
                    await winner.save();

                    if (election.type === 'class') {
                        if (['CR', 'LR'].includes(winner.position.toUpperCase())) {
                            await User.findOneAndUpdate({ name: winner.name }, { wonCRLR: true });
                        }
                    }
                }
            }
        }

        election.status = 'finalized';
        await election.save();

        await logAudit(req, 'FINALIZE_ELECTION', 'ELECTION', `Finalized results for "${election.name}". Winners have been updated.`);

        const voters = await User.find({ role: 'voter', isApproved: true }).select('email');
        const subject = `📢 Election Results Published: ${election.name}`;
        const text = `The results for "${election.name}" have been officially finalized. Visit the Results Dashboard to see the winners!`;
        
        voters.forEach(v => {
            sendEmail(v.email, subject, text).catch(e => console.error(`Failed to notify ${v.email}:`, e.message));
        });

        res.json({ msg: 'Election finalized and winners updated.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/elections/re-election/:id
// @desc    Reset election (clear votes, reset voter flags, reset candidate counts)
// @access  Private/Admin
router.post('/re-election/:id', auth, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ msg: 'Access denied. Admin only.' });
        }

        const election = await Election.findById(req.params.id);
        if (!election) return res.status(404).json({ msg: 'Election not found' });

        const Vote = require('../models/Vote');
        const Candidate = require('../models/Candidate');

        const votes = await Vote.find({ electionId: election._id.toString() }).select('voterId');
        const voterIds = votes.map(v => v.voterId);

        if (voterIds.length > 0) {
            const updateFlag = election.type === 'class' ? { hasVotedCRLR: false } : { hasVotedGS: false };
            await User.updateMany({ _id: { $in: voterIds } }, updateFlag);
        }

        await Vote.deleteMany({ electionId: election._id.toString() });
        await Candidate.updateMany({ electionId: election._id.toString() }, { voteCount: 0, isWinner: false });

        election.status = 'scheduled';
        await election.save();

        await logAudit(req, 'RESET_ELECTION', 'ELECTION', `Initiated re-election for: ${election.name}`);
        res.json({ msg: 'Re-election initiated. All votes and turnout data cleared.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/elections/report/:id
// @desc    Get detailed election report
// @access  Private/Admin
router.get('/report/:id', auth, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ msg: 'Access denied. Admin only.' });
        }

        const election = await Election.findById(req.params.id);
        if (!election) return res.status(404).json({ msg: 'Election not found' });

        const Vote = require('../models/Vote');
        const Candidate = require('../models/Candidate');

        let totalEligible;
        if (election.type === 'class') {
            const [dept, year] = election.scope.split('_');
            totalEligible = await User.countDocuments({ department: dept, year: year, isApproved: true });
        } else {
            totalEligible = await User.countDocuments({ isApproved: true });
        }

        const totalVotes = await Vote.countDocuments({ electionId: election._id.toString() });
        const turnoutPercentage = totalEligible > 0 ? (totalVotes / totalEligible) * 100 : 0;

        const candidates = await Candidate.find({ electionId: election._id.toString() }).sort({ voteCount: -1 }).lean();

        const voteStats = await Vote.aggregate([
            { $match: { electionId: election._id.toString() } },
            { $group: { _id: "$candidateId", count: { $sum: 1 } } }
        ]);

        candidates.forEach(c => {
            const stat = voteStats.find(s => s._id === c._id.toString());
            c.actualVotes = stat ? stat.count : 0;
            c.votePercentage = totalVotes > 0 ? (c.actualVotes / totalVotes) * 100 : 0;
        });

        const sortedCandidates = candidates.sort((a, b) => b.actualVotes - a.actualVotes);
        const winner = sortedCandidates[0];
        const runnerUp = sortedCandidates[1];
        const margin = winner && runnerUp ? winner.actualVotes - runnerUp.actualVotes : (winner ? winner.actualVotes : 0);

        let classBreakdown = [];
        if (election.type === 'general') {
            classBreakdown = await Vote.aggregate([
                { $match: { electionId: election._id.toString() } },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'voterId',
                        foreignField: '_id',
                        as: 'voterInfo'
                    }
                },
                { $unwind: "$voterInfo" },
                {
                    $group: {
                        _id: { dept: "$voterInfo.department", year: "$voterInfo.year" },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { "_id.dept": 1, "_id.year": 1 } }
            ]);
        }

        res.json({
            electionName: election.name,
            type: election.type,
            scope: election.scope,
            analytics: {
                totalEligible,
                totalVotes,
                turnoutPercentage: turnoutPercentage.toFixed(2),
                margin,
                winner: winner ? { name: winner.name, votes: winner.actualVotes, percent: winner.votePercentage.toFixed(2) } : null
            },
            candidates: sortedCandidates.map(c => ({
                name: c.name,
                position: c.position,
                votes: c.actualVotes,
                percent: c.votePercentage.toFixed(2)
            })),
            classBreakdown: classBreakdown.map(b => ({
                class: `${b._id.dept} ${b._id.year}`,
                votes: b.count
            }))
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
