const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Class = require('../models/Class');

// @route   GET api/classes
// @desc    Get all classes
// @access  Public
router.get('/', async (req, res) => {
    try {
        const classes = await Class.find().sort({ department: 1, admissionYear: -1 });
        res.json(classes);
    } catch (err) {
        console.error("GET /api/classes error:", err.message);
        res.status(500).json({ msg: 'Server Database Error' });
    }
});

// @route   POST api/classes
// @desc    Add a new batch
// @access  Private/Admin
router.post('/', auth, async (req, res) => {
    const { department, admissionYear, courseDuration } = req.body;

    try {
        let newClass = await Class.findOne({ department, admissionYear });
        if (newClass) {
            return res.status(400).json({ msg: 'Batch already exists for this year' });
        }

        newClass = new Class({ department, admissionYear, courseDuration });
        await newClass.save();

        const logAudit = require('../middleware/auditLog');
        await logAudit(req, 'BATCH_CREATED', 'ADMIN', `Created batch: ${department} (Admitted ${admissionYear}, ${courseDuration}yrs)`);

        res.json(newClass);
    } catch (err) {
        console.error("POST /api/classes error:", err.message);
        res.status(500).json({ msg: 'Server Error' });
    }
});

// @route   DELETE api/classes/:id
// @desc    Delete a class/batch
// @access  Private/Admin
router.delete('/:id', auth, async (req, res) => {
    try {
        const classObj = await Class.findById(req.params.id);
        if (!classObj) {
            return res.status(404).json({ msg: 'Batch not found' });
        }

        await Class.findByIdAndDelete(req.params.id);
        const logAudit = require('../middleware/auditLog');
        await logAudit(req, 'BATCH_DELETED', 'ADMIN', `Deleted batch: ${classObj.department} ${classObj.admissionYear}`);
        res.json({ msg: 'Batch removed' });
    } catch (err) {
        console.error("DELETE /api/classes error:", err.message);
        res.status(500).json({ msg: 'Server Error' });
    }
});

module.exports = router;
