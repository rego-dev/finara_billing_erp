const router = require('express').Router();
const { body, param, query } = require('express-validator');
const ctrl = require('../controllers/journalController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.use(authenticate, resolveBusiness);

router.get('/', ctrl.list);
router.get('/trial-balance', ctrl.trialBalance);
router.get('/reports/income-statement', ctrl.incomeStatement);
router.get('/reports/balance-sheet', ctrl.balanceSheet);
router.get('/:id', param('id').isInt(), validate, ctrl.getOne);

router.post('/',
  [
    body('entryDate').isISO8601(),
    body('description').notEmpty().trim(),
    body('lines').isArray({ min: 2 }),
    body('lines.*.accountId').isInt(),
    body('lines.*.debit').isFloat({ min: 0 }),
    body('lines.*.credit').isFloat({ min: 0 }),
  ],
  validate,
  ctrl.create
);

router.post('/:id/post',
  authorize('ADMIN', 'MANAGER'),
  param('id').isInt(),
  validate,
  ctrl.post
);

router.post('/:id/void',
  authorize('ADMIN', 'MANAGER'),
  [
    param('id').isInt(),
    body('adminPassword').notEmpty().withMessage('Admin password is required'),
    body('reason').notEmpty().trim().withMessage('Reason is required'),
  ],
  validate,
  ctrl.void
);

router.put('/:id',
  [param('id').isInt(), body('description').optional().trim()],
  validate,
  ctrl.update
);

module.exports = router;
