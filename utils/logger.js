const AuditLog = require('../models/AuditLog');

/**
 * Creates an audit log entry.
 * @param {Object} data - The log data.
 * @param {string} data.userId - The ID of the user performing the action.
 * @param {string} data.userName - The name of the user.
 * @param {string} data.action - The action performed.
 * @param {string} data.resource - The resource affected.
 * @param {string} [data.details] - Additional context.
 * @param {string} [data.status] - Status of the action ('success', 'failure', 'warning').
 * @param {Object} req - The Express request object to extract IP and User-Agent.
 */
const logActivity = async (data, req) => {
    try {
        const log = new AuditLog({
            userId: data.userId || null,
            userName: data.userName || (req.user ? req.user.name : null),
            action: data.action,
            resource: data.resource,
            details: data.details,
            status: data.status || 'success',
            ip: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
            userAgent: req.headers['user-agent']
        });
        await log.save();
    } catch (err) {
        console.error('Audit Log Error:', err);
    }
};

module.exports = { logActivity };
