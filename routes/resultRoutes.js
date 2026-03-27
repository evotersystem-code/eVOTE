const express = require('express');
const router = express.Router();
const Vote = require('../models/Vote');
const Candidate = require('../models/Candidate');
const Election = require('../models/Election');

// Get Results
router.get('/:identifier', async (req, res) => {
    try {
        const { identifier } = req.params;

        // Find election by ID or Name
        let election = await Election.findById(identifier).catch(() => null);
        if (!election) {
            election = await Election.findOne({ name: identifier });
        }

        if (election) {
            if (election.status !== 'ended') {
                return res.status(403).json({ msg: 'Election is still in progress. Results will be available after it ends.' });
            }
        } else {
            return res.status(404).json({ msg: 'Election not found' });
        }

        // Get all approved candidates for this election
        console.log(`[RESULTS] Searching for candidates with electionId: ${election._id.toString()}`);
        const allCandidates = await Candidate.find({
            electionId: election._id.toString(),
            isApproved: true
        });
        console.log(`[RESULTS] Found ${allCandidates.length} approved candidates.`);
        allCandidates.forEach(c => console.log(`[RESULTS] - ${c.name} (${c.position})`));

        // Aggregate current votes
        const voteCounts = await Vote.aggregate([
            { $match: { electionId: election._id.toString() } },
            { $group: { _id: "$candidateId", count: { $sum: 1 } } }
        ]);

        // Map vote counts to all candidates
        const populatedResults = allCandidates.map(candidate => {
            const voteData = voteCounts.find(v => v._id.toString() === candidate._id.toString());
            return {
                candidateName: candidate.name,
                position: candidate.position,
                party: candidate.party,
                votes: voteData ? voteData.count : 0
            };
        });

        res.json(populatedResults);

    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

module.exports = router;
