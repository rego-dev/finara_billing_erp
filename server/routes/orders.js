const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const { uploadMiddleware } = require('../utils/orderUploads');
const user = require('../controllers/orderController');
const admin = require('../controllers/orderAdminController');

// authenticate only: an order can be placed by any signed-in user and must not
// depend on resolveBusiness (which rejects a user that has no business yet).
router.use(authenticate);

// Reject non-numeric ids before any upload middleware touches the disk.
router.param('id', (req, res, next, v) => (/^\d+$/.test(v) ? next() : res.status(400).json({ error: 'Invalid order id' })));
router.param('businessId', (req, res, next, v) => (/^\d+$/.test(v) ? next() : res.status(400).json({ error: 'Invalid business id' })));

const superOnly = authorize('SUPER_ADMIN');   // ADMIN is deliberately not enough
router.get('/admin/prices',                 superOnly, admin.getPrices);
router.put('/admin/prices',                 superOnly, admin.savePrices);
router.get('/admin/instructions',           superOnly, admin.getInstructions);
router.put('/admin/instructions',           superOnly, uploadMiddleware, admin.saveInstructions);
router.get('/admin/orders',                 superOnly, admin.listOrders);
router.get('/admin/business/:businessId',   superOnly, admin.businessDetail);
router.post('/admin/orders/:id/approve',    superOnly, admin.approve);
router.post('/admin/orders/:id/reject',     superOnly, admin.reject);

router.get('/plans',            user.plans);
router.get('/payment-qr',       user.paymentQr);
router.get('/',                 user.list);
router.post('/',                user.create);
router.get('/renew/:businessId',  user.renewQuote);
router.post('/renew/:businessId', user.renew);
router.post('/:id/proof',       uploadMiddleware, user.submitProof);
router.post('/:id/cancel',      user.cancel);
router.get('/:id/proof',        user.downloadProof);

module.exports = router;
