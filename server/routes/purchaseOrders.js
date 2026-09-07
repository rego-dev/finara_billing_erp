const router = require('express').Router();
const ctrl = require('../controllers/purchaseOrderController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);

router.get('/', ctrl.list);
router.get('/:id', ctrl.getOne);
router.post('/', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.create);
router.put('/:id', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.update);
router.post('/:id/send', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.send);
router.post('/:id/receive', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.receive);
router.post('/:id/convert-to-bill', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.convertToBill);
router.post('/:id/petty-cash',      authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.payFromPettyCash);
router.post('/:id/cancel', authorize('ADMIN', 'MANAGER'), ctrl.cancel);
router.delete('/:id', authorize('ADMIN', 'MANAGER'), ctrl.remove);

module.exports = router;
