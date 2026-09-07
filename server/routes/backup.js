const router = require('express').Router();
const ctrl   = require('../controllers/backupController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness, authorize('ADMIN'));

// List available modules
router.get('/modules', ctrl.listModules);

// Export selected modules as JSON
router.get('/export', ctrl.exportData);

// Import / restore from uploaded JSON file
router.post('/import', ctrl.uploadMiddleware, ctrl.importData);

// Reset selected modules (delete all data for those modules)
router.post('/reset', ctrl.resetModules);

module.exports = router;
