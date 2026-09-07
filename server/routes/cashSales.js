const router = require('express').Router();
const ctrl = require('../controllers/cashSaleController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);

router.get('/',    ctrl.list);
router.get('/:id', ctrl.getOne);
router.post('/',   authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.create);
router.post('/:id/void', authorize('ADMIN', 'MANAGER'), ctrl.voidSale);

module.exports = router;
