const router = require('express').Router();
const ctrl   = require('../controllers/expenseController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');

const write   = authorize('ADMIN', 'MANAGER', 'ACCOUNTANT');
const approve = authorize('ADMIN', 'MANAGER');

router.use(authenticate, resolveBusiness);

router.get('/categories',        ctrl.getCategories);
router.get('/summary',           ctrl.getSummary);
router.get('/',                  ctrl.list);
router.get('/:id',               ctrl.get);
router.post('/',                 write,   ctrl.create);
router.put('/:id',               write,   ctrl.update);
router.post('/:id/submit',       write,   ctrl.submit);
router.post('/:id/approve',      approve, ctrl.approve);
router.post('/:id/pay',          approve, ctrl.pay);
router.post('/:id/reject',       approve, ctrl.reject);
router.post('/:id/void',         approve, ctrl.void);
router.delete('/:id',            write,   ctrl.remove);

module.exports = router;
