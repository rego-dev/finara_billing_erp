const router = require('express').Router();
const ctrl = require('../controllers/attachmentController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);

// Download a single attachment (literal "download" 2nd segment — declared first
// so it is matched before the generic /:entity/:entityId list route).
router.get('/:id/download', ctrl.download);

// Delete a single attachment
router.delete('/:id', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.remove);

// List + upload for a given entity record
router.get('/:entity/:entityId', ctrl.list);
router.post('/:entity/:entityId', ctrl.uploadMiddleware, ctrl.create);

module.exports = router;
