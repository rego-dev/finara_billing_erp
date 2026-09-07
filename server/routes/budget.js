const router = require('express').Router();
const ctrl = require('../controllers/budgetController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);

router.get('/', ctrl.list);
router.get('/:id', ctrl.getOne);
router.get('/:id/vs-actual', ctrl.vsActual);
router.post('/', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.create);
router.put('/:id', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.update);
router.delete('/:id', authorize('ADMIN', 'MANAGER'), ctrl.remove);

module.exports = router;
