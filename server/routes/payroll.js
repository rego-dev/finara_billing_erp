const router = require('express').Router();
const { body, param } = require('express-validator');
const ctrl = require('../controllers/payrollController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.use(authenticate, resolveBusiness);
// Payroll (incl. salaries) is sensitive — no VIEWER access to any endpoint.
// Writes are further restricted per-route below (ADMIN/MANAGER, ADMIN for approve).
router.use(authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'));

// Employees
router.get('/employees', ctrl.listEmployees);
router.get('/employees/:id', param('id').isInt(), validate, ctrl.getEmployee);
router.post('/employees', authorize('ADMIN','MANAGER'),
  [
    body('firstName').notEmpty().trim(),
    body('lastName').notEmpty().trim(),
    body('hireDate').isISO8601(),
    body('basicSalary').isFloat({ min: 0 }),
    body('payFrequency').isIn(['MONTHLY','SEMI_MONTHLY','WEEKLY']),
    body('employmentType').isIn(['REGULAR','PROBATIONARY','CONTRACTUAL','PART_TIME']),
  ], validate, ctrl.createEmployee);
router.put('/employees/:id', authorize('ADMIN','MANAGER'), ctrl.updateEmployee);

// Payroll periods & computation
router.get('/periods', ctrl.listPeriods);
router.post('/periods', authorize('ADMIN','MANAGER'),
  [body('periodName').notEmpty(), body('startDate').isISO8601(), body('endDate').isISO8601(), body('payDate').isISO8601()],
  validate, ctrl.createPeriod);
router.put('/periods/:id', authorize('ADMIN','MANAGER'), param('id').isInt(), validate, ctrl.updatePeriod);
router.post('/periods/:id/compute', authorize('ADMIN','MANAGER'), param('id').isInt(), validate, ctrl.computePeriod);
router.post('/periods/:id/approve', authorize('ADMIN'), param('id').isInt(), validate, ctrl.approvePeriod);
router.get('/periods/:id/items', param('id').isInt(), validate, ctrl.getPeriodItems);
router.get('/calculator', ctrl.calculator);
router.get('/bir2316/:employeeId/:year', ctrl.generate2316);

module.exports = router;
