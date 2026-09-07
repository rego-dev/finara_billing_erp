const router = require('express').Router();
const ctrl = require('../controllers/recurringController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);

router.get('/', ctrl.list);
router.post('/run-due', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.runDue);
router.get('/:id', ctrl.getOne);
router.post('/', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.create);
router.put('/:id', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.update);
router.post('/:id/run', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.runNow);
router.post('/:id/toggle', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.toggle);
router.delete('/:id', authorize('ADMIN', 'MANAGER'), ctrl.remove);

module.exports = router;
