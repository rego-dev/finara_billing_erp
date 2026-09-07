const router = require('express').Router();
const ctrl = require('../controllers/birController');
const { authenticate, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);

router.get('/vat-summary', ctrl.vatSummary);          // 2550M/Q input
router.get('/ewt-summary', ctrl.ewtSummary);           // 1601-EQ
router.get('/withholding-summary', ctrl.withholdingSummary); // 1601-C
router.get('/relief', ctrl.reliefExport);              // BIR RELIEF export data
router.get('/alphalist', ctrl.alphalist);              // Alphalist of employees

module.exports = router;
