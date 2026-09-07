const router = require('express').Router();
const ctrl = require('../controllers/permissionsController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);

router.get('/', ctrl.get);                       // any authenticated user (to know their own access)
router.put('/', authorize('ADMIN'), ctrl.save);  // only ADMIN may change permissions

router.get('/disabled-modules', ctrl.getDisabled);                            // any authenticated user (Sidebar/layout need it)
router.put('/disabled-modules', authorize('SUPER_ADMIN'), ctrl.saveDisabled); // only SUPER_ADMIN

module.exports = router;
