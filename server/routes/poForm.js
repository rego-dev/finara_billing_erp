const router = require('express').Router();
const { authenticate, resolveBusiness } = require('../middleware/auth');
const ctrl = require('../controllers/poFormController');

// GET /api/po-form/blank — generate & download blank PO PDF with company details
// resolveBusiness attaches req.businessId from the x-business-id header so the
// PDF uses the currently selected company's logo & details.
router.get('/blank', authenticate, resolveBusiness, ctrl.generateBlankForm);

module.exports = router;
