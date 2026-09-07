const router = require('express').Router();
const { body, param } = require('express-validator');
const ctrl = require('../controllers/quotationController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.use(authenticate, resolveBusiness);

const lineValidators = [
  body('customerId').isInt(),
  body('quotationDate').isISO8601(),
  body('validUntil').isISO8601(),
  body('lines').isArray({ min: 1 }),
  // No accountId here — a quotation carries no GL account. The revenue
  // account is assigned at convert-to-invoice time.
  body('lines.*.description').notEmpty(),
  body('lines.*.quantity').isFloat({ min: 0.001 }),
  body('lines.*.unitPrice').isFloat({ min: 0 }),
  body('lines.*.vatCode').isIn(['VAT', 'EXEMPT', 'ZERO']),
];

router.get('/', ctrl.list);
router.get('/:id', param('id').isInt(), validate, ctrl.get);
router.post('/', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), lineValidators, validate, ctrl.create);
router.put('/:id', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), param('id').isInt(), validate, ctrl.update);
router.delete('/:id', authorize('ADMIN', 'MANAGER'), param('id').isInt(), validate, ctrl.remove);

router.post('/:id/send',    param('id').isInt(), validate, ctrl.send);
router.post('/:id/accept',  param('id').isInt(), validate, ctrl.accept);
router.post('/:id/reject',  param('id').isInt(), validate, ctrl.reject);
router.get('/:id/convert-preview', param('id').isInt(), validate, ctrl.convertPreview);
router.post('/:id/convert', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), param('id').isInt(), validate, ctrl.convert);

module.exports = router;
