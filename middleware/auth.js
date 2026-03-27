const jwt = require('jsonwebtoken');
const BlacklistedToken = require('../models/BlacklistedToken');

module.exports = async function (req, res, next) {
    // SECURITY: Use httpOnly cookies exclusively to prevent XSS-based token theft
    const token = req.cookies.token;

    // Check if not token
    if (!token) {
        return res.status(401).json({ msg: 'No token, authorization denied' });
    }

    // Check if token is blacklisted
    const User = require('../models/User');
    const isBlacklisted = await BlacklistedToken.findOne({ token });
    if (isBlacklisted) {
        return res.status(401).json({ msg: 'Token invalidated (logged out), please login again' });
    }

    // Verify token
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded.user;

        // Update heartbeat (lastSeen)
        try {
            const INACTIVITY_LIMIT = 30 * 60 * 1000; // 30 mins
            const user = await User.findById(req.user.id);
            if (user) {
                const lastSeenTime = new Date(user.lastSeen || Date.now()).getTime();
                const tokenAge = Date.now() - (decoded.iat * 1000);
                
                // Only enforce inactivity if token is older than 1 minute (to avoid race conditions on login)
                // and if lastSeen is actually set to something historical.
                if (tokenAge > 60000 && Date.now() - lastSeenTime > INACTIVITY_LIMIT) {
                    console.warn(`[AUTH] Session expired for user ${user.email} (Last seen: ${new Date(lastSeenTime).toISOString()})`);
                    return res.status(401).json({ msg: 'Session expired due to inactivity. Please login again.' });
                }
                await User.findByIdAndUpdate(req.user.id, { lastSeen: Date.now() });
            }
        } catch (dbErr) {
            console.error("[AUTH] Middleware DB error:", dbErr.message);
        }

        next();
    } catch (err) {
        console.error(`[AUTH] Token verification failed: ${err.message}`);
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ msg: 'Token expired' });
        }
        res.status(401).json({ msg: 'Token is not valid' });
    }
};
