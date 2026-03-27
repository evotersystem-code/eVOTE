const mongoose = require('mongoose');
require('dotenv').config();

const Election = require('./models/Election');
const Candidate = require('./models/Candidate');

async function repair() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connected to MongoDB...");

        // 1. Check for active elections
        let activeClassElection = await Election.findOne({ type: 'class', status: 'active' });
        let activeGenElection = await Election.findOne({ type: 'general', status: 'active' });

        if (!activeClassElection) {
            console.log("Creating sample active Class Election...");
            activeClassElection = new Election({
                name: "Class Representatives Election 2026",
                date: new Date(),
                startTime: new Date(),
                endTime: new Date(Date.now() + 86400000), // 24 hours from now
                type: 'class',
                status: 'active'
            });
            await activeClassElection.save();
        }

        if (!activeGenElection) {
            console.log("Creating sample active General Election...");
            activeGenElection = new Election({
                name: "Student Council Election 2026",
                date: new Date(),
                startTime: new Date(),
                endTime: new Date(Date.now() + 86400000),
                type: 'general',
                status: 'active'
            });
            await activeGenElection.save();
        }

        // 2. Link approved candidates to these elections if they have invalid IDs
        // Ananya Rao is DGS (General Council)
        // Sneha Patil is LR (Class Representative)
        
        console.log("Updating Ananya Rao (DGS) to new General Election...");
        await Candidate.updateOne(
            { name: "Ananya Rao", isApproved: true },
            { electionId: activeGenElection._id }
        );

        console.log("Updating Sneha Patil (LR) to new Class Election...");
        await Candidate.updateOne(
            { name: "Sneha Patil", isApproved: true },
            { electionId: activeClassElection._id }
        );

        console.log("\n✅ REPAIR COMPLETE!");
        console.log(`Class Election ID: ${activeClassElection._id}`);
        console.log(`General Election ID: ${activeGenElection._id}`);

        await mongoose.disconnect();
    } catch (err) {
        console.error("Repair failed:", err);
        process.exit(1);
    }
}

repair();
