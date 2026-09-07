const router = require('express').Router();
const ctrl = require('../controllers/bankController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);

// Accounts
router.get('/accounts', ctrl.listAccounts);
router.post('/accounts', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.createAccount);
router.put('/accounts/:id', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.updateAccount);
router.delete('/accounts/:id', authorize('ADMIN', 'MANAGER'), ctrl.removeAccount);

// Transactions
router.get('/transactions', ctrl.listTransactions);
router.post('/transactions', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.createTransaction);
router.delete('/transactions/:id', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.removeTransaction);

// Reconciliations
router.get('/reconciliations', ctrl.listReconciliations);
router.get('/reconciliations/:id', ctrl.getReconciliation);
router.post('/reconciliations', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.createReconciliation);
router.post('/reconciliations/:id/toggle/:txnId', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.toggleTransaction);
router.post('/reconciliations/:id/complete', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.completeReconciliation);

module.exports = router;
