const router = require('express').Router();
const ctrl   = require('../controllers/cashPositionController');
const { authenticate, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);

// Static path first so it is not swallowed by a future `/:id`
router.get('/cash-position/day', ctrl.day);
router.get('/cash-position',     ctrl.report);

module.exports = router;
