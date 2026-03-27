const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const User = require('./models/User');

async function checkUsers() {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/evote');
        
        const total = await User.countDocuments();
        const withFace = await User.countDocuments({ faceDescriptor: { $exists: true, $ne: [] } });
        const approved = await User.countDocuments({ isApproved: true });
        const roleDist = await User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]);

        console.log("--- USER DATA SUMMARY ---");
        console.log(`Total Users: ${total}`);
        console.log(`Users with Biometrics: ${withFace}`);
        console.log(`Users WITHOUT Biometrics: ${total - withFace}`);
        console.log(`Approved Users: ${approved}`);
        console.log(`Pending/Rejected Users: ${total - approved}`);
        console.log("Role Distribution:", JSON.stringify(roleDist, null, 2));
        console.log("--- END SUMMARY ---");

        process.exit(0);
    } catch (err) {
        console.error("Diagnostic failed:", err);
        process.exit(1);
    }
}

checkUsers();
