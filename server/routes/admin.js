const router = require('express').Router();
const ctrl   = require('../controllers/adminController');
const { authenticate, authorize } = require('../middleware/auth');

// All admin override routes — ADMIN only
router.use(authenticate, authorize('ADMIN'));

router.get   ('/gl-diag',                  ctrl.glDiag);
router.get   ('/journal-entries',          ctrl.listEntries);
router.patch ('/journal-entries/:id/unpost', ctrl.unpostEntry);
router.delete('/journal-entries/:id',      ctrl.forceDeleteEntry);

router.get   ('/bills',             ctrl.listBills);
router.patch ('/bills/:id/unpost',  ctrl.unpostBill);
router.delete('/bills/:id',         ctrl.forceDeleteBill);

router.get   ('/invoices',    ctrl.listInvoices);
router.delete('/invoices/:id', ctrl.forceDeleteInvoice);

module.exports = router;
