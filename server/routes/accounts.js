const router = require('express').Router();
const { body, param, query } = require('express-validator');
const ctrl = require('../controllers/accountsController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.use(authenticate, resolveBusiness);

router.get('/', ctrl.list);
router.get('/tree', ctrl.tree);
router.get('/types', ctrl.getTypes);
router.get('/:id', param('id').isInt(), validate, ctrl.getOne);

router.post('/',
  authorize('ADMIN', 'MANAGER'),
  [
    body('accountName').notEmpty().trim(),
    body('accountType').isIn(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']),
    body('normalBalance').isIn(['DEBIT', 'CREDIT']),
    body('parentId').optional().isInt(),
  ],
  validate,
  ctrl.create
);

router.put('/:id',
  authorize('ADMIN', 'MANAGER'),
  [param('id').isInt(), body('accountName').optional().trim()],
  validate,
  ctrl.update
);

router.delete('/:id', authorize('ADMIN'), param('id').isInt(), validate, ctrl.remove);

module.exports = router;
