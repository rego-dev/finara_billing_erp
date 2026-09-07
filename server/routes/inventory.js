const router = require('express').Router();
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');
const c = require('../controllers/inventoryController');

router.use(authenticate, resolveBusiness);

// ── Categories ────────────────────────────────────────────────
router.get   ('/categories',        c.listCategories);
router.post  ('/categories',        authorize('ADMIN','MANAGER','ACCOUNTANT'), c.createCategory);
router.put   ('/categories/:id',    authorize('ADMIN','MANAGER','ACCOUNTANT'), c.updateCategory);
router.delete('/categories/:id',    authorize('ADMIN','MANAGER'),              c.deleteCategory);

// ── Reports (before /:id to avoid clash) ─────────────────────
router.get('/reports/stock-on-hand',     c.stockOnHand);
router.get('/reports/valuation',         c.valuationReport);
router.get('/reports/low-stock',         c.lowStockReport);
router.get('/reports/movement-summary',  c.movementSummary);

// ── Transactions ──────────────────────────────────────────────
router.get ('/transactions',    c.listTransactions);
router.post('/transactions',    authorize('ADMIN','MANAGER','ACCOUNTANT'), c.createTransaction);

// ── Items ─────────────────────────────────────────────────────
router.get   ('/',      c.listItems);
router.post  ('/',      authorize('ADMIN','MANAGER','ACCOUNTANT'), c.createItem);
router.get   ('/:id',   c.getItem);
router.put   ('/:id',   authorize('ADMIN','MANAGER','ACCOUNTANT'), c.updateItem);
router.delete('/:id',   authorize('ADMIN','MANAGER'),              c.deleteItem);

module.exports = router;
