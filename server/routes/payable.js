const router = require('express').Router();
const { body, param } = require('express-validator');
const ctrl = require('../controllers/payableController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.use(authenticate, resolveBusiness);

// Vendors
router.get('/vendors', ctrl.listVendors);
router.post('/vendors', authorize('ADMIN','MANAGER'),
  [body('name').notEmpty().trim()], validate, ctrl.createVendor);
router.put('/vendors/:id', authorize('ADMIN','MANAGER'), ctrl.updateVendor);

// Bills
router.get('/', ctrl.listBills);
router.get('/aging', ctrl.agingReport);
router.get('/cheques', ctrl.listCheques);
router.get('/:id', param('id').isInt(), validate, ctrl.getBill);
router.post('/',
  [
    body('vendorId').isInt(),
    body('billDate').isISO8601(),
    body('dueDate').isISO8601(),
    body('lines').isArray({ min: 1 }),
    body('lines.*.accountId').isInt(),
    body('lines.*.description').notEmpty(),
    body('lines.*.quantity').isFloat({ min: 0.001 }),
    body('lines.*.unitPrice').isFloat({ min: 0 }),
    body('lines.*.vatCode').isIn(['VAT','EXEMPT','ZERO']),
  ],
  validate, ctrl.createBill);
router.post('/:id/payment',
  [
    param('id').isInt(),
    body('paymentDate').isISO8601(),
    body('amount').isFloat({ min: 0.01 }),
    body('paymentMethod').notEmpty(),
    body('checkDate').optional({ checkFalsy: true }).isISO8601(),
  ],
  validate, ctrl.recordPayment);
router.put('/:id',
  [
    param('id').isInt(),
    body('vendorId').isInt(),
    body('billDate').isISO8601(),
    body('dueDate').isISO8601(),
    body('lines').isArray({ min: 1 }),
    body('lines.*.accountId').isInt(),
    body('lines.*.description').notEmpty(),
    body('lines.*.quantity').isFloat({ min: 0.001 }),
    body('lines.*.unitPrice').isFloat({ min: 0 }),
    body('lines.*.vatCode').isIn(['VAT','EXEMPT','ZERO']),
  ],
  validate, ctrl.updateBill);
router.put('/:id/payment/:paymentId',
  authorize('ADMIN','MANAGER'),
  [
    param('id').isInt(),
    param('paymentId').isInt(),
    body('paymentDate').isISO8601(),
    body('amount').isFloat({ min: 0 }),
    body('paymentMethod').notEmpty(),
    body('checkDate').optional({ checkFalsy: true }).isISO8601(),
  ],
  validate, ctrl.editPayment);
router.post('/:id/void', authorize('ADMIN','MANAGER'), param('id').isInt(), validate, ctrl.voidBill);

// Cheques
router.post('/cheques/:paymentId/clear',
  authorize('ADMIN','MANAGER'),
  [param('paymentId').isInt(), body('clearDate').isISO8601()],
  validate, ctrl.clearCheque);
router.post('/cheques/:paymentId/bounce',
  authorize('ADMIN','MANAGER'),
  [param('paymentId').isInt(), body('reason').notEmpty()],
  validate, ctrl.bounceCheque);
router.post('/cheques/:paymentId/cancel',
  authorize('ADMIN','MANAGER'),
  [param('paymentId').isInt(), body('reason').notEmpty()],
  validate, ctrl.cancelCheque);

module.exports = router;
