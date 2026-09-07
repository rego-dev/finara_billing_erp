const router = require('express').Router();
const ctrl = require('../controllers/openingBalanceController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);

router.get('/',          ctrl.get);
router.get('/reconcile', ctrl.reconcile);
router.post('/',         authorize('ADMIN', 'MANAGER'), ctrl.create);

module.exports = router;
