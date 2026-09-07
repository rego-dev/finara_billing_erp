const router = require('express').Router();
const ctrl = require('../controllers/assetController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);

router.get('/', ctrl.list);
router.get('/summary', ctrl.summary);
router.get('/:id', ctrl.getOne);
router.get('/:id/schedule', ctrl.schedule);
router.post('/', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.create);
router.put('/:id', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.update);
router.post('/:id/depreciate', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.runDepreciation);
router.post('/:id/dispose', authorize('ADMIN', 'MANAGER'), ctrl.dispose);
router.delete('/:id', authorize('ADMIN', 'MANAGER'), ctrl.remove);

module.exports = router;
