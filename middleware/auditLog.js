const AuditLog = require('../models/AuditLog');

const logAudit = async (req, action, resource, details, status = 'success') => {
    try {
        const audit = new AuditLog({
            userId: req.user ? req.user.id : null,
            userName: req.user ? req.user.name : 'Unauthenticated',
            action,
            resource,
            details,
            status,
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });
        await audit.save();
    } catch (err) {
        console.error('Audit logging failed:', err.message);
    }
};

module.exports = logAudit;
