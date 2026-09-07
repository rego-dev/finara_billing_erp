const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/poScannerController');

// POST /api/po-scanner/scan — upload image, OCR, return parsed PO data
router.post('/scan', authenticate, ctrl.upload.single('image'), ctrl.scan);

module.exports = router;
