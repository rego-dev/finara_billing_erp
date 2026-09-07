const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/leadController');
const { authenticate, authorize } = require('../middleware/auth');
const { apiKeyAuth } = require('../middleware/apiKeyAuth');

// Public endpoint — keep a tight limit to deter spam bots.
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Please try again later.' },
});

router.post('/', submitLimiter, ctrl.create);
router.get('/export', apiKeyAuth, ctrl.exportList);
router.get('/', authenticate, authorize('ADMIN', 'MANAGER'), ctrl.list);

module.exports = router;
