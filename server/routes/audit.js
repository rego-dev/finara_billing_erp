const router = require('express').Router();
const ctrl = require('../controllers/auditController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');

// Audit trail is sensitive — restricted to ADMIN and MANAGER.
router.use(authenticate, authorize('ADMIN', 'MANAGER'));

router.get('/', ctrl.list);
router.get('/filters', ctrl.filters);

module.exports = router;
