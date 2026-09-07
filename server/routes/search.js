const router = require('express').Router();
const ctrl = require('../controllers/searchController');
const { authenticate, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);
router.get('/', ctrl.search);

module.exports = router;
