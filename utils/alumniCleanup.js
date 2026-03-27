const User = require('../models/User');
const Class = require('../models/Class');

/**
 * Automatically identifies and deletes voters who have completed their course duration.
 * This ensures the system only contains active students.
 */
async function cleanupAlumni() {
    try {
        console.log("[CLEANUP] Starting pre-session alumni cleanup...");
        
        const now = new Date();
        const curYear = now.getFullYear();
        const curMonth = now.getMonth(); // 0-11
        
        // Academic session typically starts in June (Month 5)
        // If before June, the current session year is previous calendar year.
        const currentAcademicYear = curMonth < 5 ? curYear - 1 : curYear;

        // Find all batches (Classes)
        const batches = await Class.find({});
        
        // Filter batches that are completed
        // Logic: (Current Year - Admission Year) + 1 > Duration
        // Example: Admitted 2023, Duration 3. In 2026-27 session: (2026-2023)+1 = 4. 4 > 3 -> Delete.
        const completedBatchIds = batches
            .filter(b => (currentAcademicYear - b.admissionYear) + 1 > b.courseDuration)
            .map(b => b._id);

        if (completedBatchIds.length === 0) {
            console.log("[CLEANUP] No completed batches found. System is up to date.");
            return;
        }

        console.log(`[CLEANUP] Identified ${completedBatchIds.length} completed batches. Searching for associated alumni...`);

        // Delete voters belonging to these batches
        // We only delete 'voter' role to preserve admin/staff for that department if they were manually elevated
        const result = await User.deleteMany({ 
            batchId: { $in: completedBatchIds }, 
            role: 'voter',
            isApproved: true // Optional: only delete approved ones, but usually delete all
        });
        
        if (result.deletedCount > 0) {
            console.log(`[CLEANUP] SUCCESS: Automatically deleted ${result.deletedCount} alumni voters from the system.`);
        } else {
            console.log("[CLEANUP] No voters found in completed batches.");
        }

    } catch (err) {
        console.error("[CLEANUP] ERROR: Alumni cleanup task failed:", err.message);
    }
}

// Export for server startup and scheduling
module.exports = cleanupAlumni;
