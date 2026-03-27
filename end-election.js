const mongoose = require('mongoose');
const Election = require('./models/Election');
require('dotenv').config();

async function endElection() {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/college-voting');

        const now = new Date();
        const election = await Election.findOne().sort({ date: -1 });

        if (election) {
            election.status = 'ended';
            election.endTime = now;
            await election.save();
            console.log(`Forced election to ENDED: ${election.name}`);
        } else {
            console.log("No election found to end.");
        }
        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

endElection();
