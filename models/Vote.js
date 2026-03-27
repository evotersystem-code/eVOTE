const mongoose = require('mongoose');

const voteSchema = mongoose.Schema({
    voterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true },
    electionId: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    previousHash: { type: String }, // For simple hash chaining
    hash: { type: String } // Current vote hash
});

module.exports = mongoose.model('Vote', voteSchema);
