const router = require('express').Router();
const { body, param } = require('express-validator');
const ctrl = require('../controllers/receivableController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.use(authenticate, resolveBusiness);

router.get('/customers', ctrl.listCustomers);
router.post('/customers', authorize('ADMIN','MANAGER'),
  [body('name').notEmpty().trim()], validate, ctrl.createCustomer);
router.put('/customers/:id', authorize('ADMIN','MANAGER'), ctrl.updateCustomer);

router.get('/', ctrl.listInvoices);
router.get('/aging', ctrl.agingReport);
router.get('/:id', param('id').isInt(), validate, ctrl.getInvoice);
router.post('/',
  [
    body('customerId').isInt(),
    body('invoiceDate').isISO8601(),
    body('dueDate').isISO8601(),
    body('lines').isArray({ min: 1 }),
    body('lines.*.accountId').isInt(),
    body('lines.*.description').notEmpty(),
    body('lines.*.quantity').isFloat({ min: 0.001 }),
    body('lines.*.unitPrice').isFloat({ min: 0 }),
    body('lines.*.vatCode').isIn(['VAT','EXEMPT','ZERO']),
  ],
  validate, ctrl.createInvoice);
router.put('/:id',
  [
    param('id').isInt(),
    body('customerId').isInt(),
    body('invoiceDate').isISO8601(),
    body('dueDate').isISO8601(),
    body('lines').isArray({ min: 1 }),
    body('lines.*.accountId').isInt(),
    body('lines.*.description').notEmpty(),
    body('lines.*.quantity').isFloat({ min: 0.001 }),
    body('lines.*.unitPrice').isFloat({ min: 0 }),
    body('lines.*.vatCode').isIn(['VAT','EXEMPT','ZERO']),
  ],
  validate, ctrl.updateInvoice);
router.post('/:id/payment',
  [param('id').isInt(), body('paymentDate').isISO8601(), body('amount').isFloat({ min: 0.01 }), body('paymentMethod').notEmpty()],
  validate, ctrl.recordPayment);
router.post('/:id/void', authorize('ADMIN','MANAGER'), param('id').isInt(), validate, ctrl.voidInvoice);
router.post('/:id/ship', param('id').isInt(), validate, ctrl.markShipped);

module.exports = router;
