const router = require('express').Router();
const ctrl = require('../controllers/notificationController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);

router.get('/status', ctrl.status);
router.get('/feed', ctrl.feed);
router.post('/invoice/:id', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.emailInvoice);
router.post('/overdue-reminders', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.sendOverdueReminders);

module.exports = router;
