const router = require('express').Router();
const ctrl = require('../controllers/cashRequestController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);

router.get('/',    ctrl.list);
router.get('/summary',      ctrl.summary);
router.get('/unliquidated', ctrl.unliquidated);
router.get('/account-map',  ctrl.accountMap);
router.get('/:id', ctrl.getOne);
router.post('/',   authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.create);
router.put('/:id', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.update);

router.post('/:id/submit',  authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.submit);
router.post('/:id/approve', authorize('ADMIN', 'MANAGER'),               ctrl.approve);
router.post('/:id/reject',  authorize('ADMIN', 'MANAGER'),               ctrl.reject);
router.post('/:id/cancel',  authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.cancel);
router.post('/:id/release', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.release);
router.post('/:id/liquidate', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.liquidate);

module.exports = router;
