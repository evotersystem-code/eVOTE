const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const User = require('./models/User');

async function checkUsers() {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/evote');
        console.log("Connected to MongoDB");

        const total = await User.countDocuments();
        const withFace = await User.countDocuments({ faceDescriptor: { $exists: true, $ne: [] } });
        const withoutFace = total - withFace;

        console.log(`Total Users: ${total}`);
        console.log(`Users with Face: ${withFace}`);
        console.log(`Users WITHOUT Face: ${withoutFace}`);

        const roles = await User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]);
        console.log("Roles distribution:", roles);

        const samples = await User.find({}, 'name email rollNumber prn role isApproved status').limit(5);
        console.log("Sample Users:", JSON.stringify(samples, null, 2));

        process.exit(0);
    } catch (err) {
        console.error("Diagnostic failed:", err);
        process.exit(1);
    }
}

checkUsers();
