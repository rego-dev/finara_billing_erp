const router = require('express').Router();
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');
const ctrl = require('../controllers/businessController');

const adminOnly = authorize('ADMIN');

router.use(authenticate, resolveBusiness);

router.get('/',                              ctrl.list);
router.post('/reset-demo', adminOnly,        ctrl.resetDemo);
router.get('/:id',                           ctrl.get);
router.post('/',           adminOnly,        ctrl.create);
router.put('/:id',         adminOnly,        ctrl.update);
router.get('/:id/users',   adminOnly,        ctrl.listUsers);
router.post('/:id/users',  adminOnly,        ctrl.grantUser);
router.delete('/:id/users/:userId', adminOnly, ctrl.revokeUser);

module.exports = router;
