/**
 * Hand-written OpenAPI 3.0 spec for the Finara ERP API.
 * Served via swagger-ui-express at /api/docs.
 * Covers authentication and the core/new modules; extend as endpoints evolve.
 */
const bearer = [{ bearerAuth: [] }];

const ok = (desc = 'Success') => ({ 200: { description: desc } });
const created = { 201: { description: 'Created' } };

const path = (summary, tag, { method = 'get', auth = true, body = false, params = [], responses } = {}) => ({
  [method]: {
    tags: [tag],
    summary,
    ...(auth && { security: bearer }),
    ...(params.length && { parameters: params }),
    ...(body && { requestBody: { content: { 'application/json': { schema: { type: 'object' } } } } }),
    responses: responses || (method === 'post' ? created : ok()),
  },
});

const idParam = [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }];

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Finara ERP API',
    version: '1.0.0',
    description: 'Philippine-compliant ERP API — Chart of Accounts, GL, AP/AR, Payroll, BIR, Inventory, Purchase Orders, Fixed Assets, Bank Reconciliation, Budgeting, Recurring Entries, Audit Trail.',
  },
  servers: [{ url: '/api', description: 'Same-origin (proxied by Next.js)' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  },
  tags: [
    { name: 'Auth' }, { name: 'Audit' }, { name: 'Attachments' },
    { name: 'Purchase Orders' }, { name: 'Fixed Assets' }, { name: 'Bank' },
    { name: 'Budget' }, { name: 'Recurring' }, { name: 'Notifications' },
  ],
  paths: {
    // Auth
    '/auth/login': path('Login (returns JWT tokens)', 'Auth', { method: 'post', auth: false, body: true, responses: ok('Tokens issued') }),
    '/auth/refresh': path('Refresh access token', 'Auth', { method: 'post', auth: false, body: true }),
    '/auth/forgot-password': path('Request a password reset token', 'Auth', { method: 'post', auth: false, body: true }),
    '/auth/reset-password': path('Reset password using a token', 'Auth', { method: 'post', auth: false, body: true }),
    '/auth/me': path('Current authenticated user', 'Auth'),
    '/auth/change-password': { ...path('Change own password', 'Auth', { method: 'put', body: true }) },

    // Audit
    '/audit': path('List audit log events (ADMIN/MANAGER)', 'Audit', {
      params: [
        { name: 'action', in: 'query', schema: { type: 'string' } },
        { name: 'entity', in: 'query', schema: { type: 'string' } },
        { name: 'search', in: 'query', schema: { type: 'string' } },
        { name: 'page', in: 'query', schema: { type: 'integer' } },
      ],
    }),
    '/audit/filters': path('Distinct action/entity values for filters', 'Audit'),

    // Attachments
    '/attachments/{entity}/{entityId}': {
      ...path('List attachments for a record', 'Attachments', {
        params: [
          { name: 'entity', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'entityId', in: 'path', required: true, schema: { type: 'integer' } },
        ],
      }),
      post: {
        tags: ['Attachments'], summary: 'Upload a file (multipart/form-data, field "file")', security: bearer,
        parameters: [
          { name: 'entity', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'entityId', in: 'path', required: true, schema: { type: 'integer' } },
        ],
        requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } } },
        responses: created,
      },
    },
    '/attachments/{id}/download': path('Download an attachment', 'Attachments', { params: idParam, responses: ok('File stream') }),

    // Purchase Orders
    '/purchase-orders': {
      ...path('List purchase orders', 'Purchase Orders'),
      post: path('Create a purchase order', 'Purchase Orders', { method: 'post', body: true }).post,
    },
    '/purchase-orders/{id}': path('Get a purchase order', 'Purchase Orders', { params: idParam }),
    '/purchase-orders/{id}/receive': path('Record received quantities', 'Purchase Orders', { method: 'post', body: true, params: idParam }),
    '/purchase-orders/{id}/convert-to-bill': path('Convert PO to an AP Bill (auto-posts GL)', 'Purchase Orders', { method: 'post', body: true, params: idParam }),

    // Fixed Assets
    '/assets': { ...path('List fixed assets', 'Fixed Assets'), post: path('Create asset', 'Fixed Assets', { method: 'post', body: true }).post },
    '/assets/summary': path('Asset totals (cost / accumulated / book value)', 'Fixed Assets'),
    '/assets/{id}/schedule': path('Projected depreciation schedule', 'Fixed Assets', { params: idParam }),
    '/assets/{id}/depreciate': path('Record one depreciation period (auto-posts GL if accounts set)', 'Fixed Assets', { method: 'post', body: true, params: idParam }),
    '/assets/{id}/dispose': path('Dispose an asset', 'Fixed Assets', { method: 'post', body: true, params: idParam }),

    // Bank
    '/bank/accounts': { ...path('List bank accounts', 'Bank'), post: path('Create bank account', 'Bank', { method: 'post', body: true }).post },
    '/bank/transactions': { ...path('List bank transactions', 'Bank'), post: path('Add bank transaction', 'Bank', { method: 'post', body: true }).post },
    '/bank/reconciliations': { ...path('List reconciliations', 'Bank'), post: path('Start a reconciliation', 'Bank', { method: 'post', body: true }).post },
    '/bank/reconciliations/{id}': path('Get reconciliation with transactions', 'Bank', { params: idParam }),
    '/bank/reconciliations/{id}/complete': path('Complete a reconciliation', 'Bank', { method: 'post', body: true, params: idParam }),

    // Budget
    '/budget': { ...path('List budgets', 'Budget'), post: path('Create budget', 'Budget', { method: 'post', body: true }).post },
    '/budget/{id}/vs-actual': path('Budget vs actual report', 'Budget', { params: idParam }),

    // Recurring
    '/recurring': { ...path('List recurring templates', 'Recurring'), post: path('Create recurring template', 'Recurring', { method: 'post', body: true }).post },
    '/recurring/run-due': path('Run all due templates', 'Recurring', { method: 'post' }),
    '/recurring/{id}/run': path('Run a template now', 'Recurring', { method: 'post', params: idParam }),

    // Notifications
    '/notifications/status': path('Whether email (SMTP) is configured', 'Notifications'),
    '/notifications/invoice/{id}': path('Email an invoice to its customer', 'Notifications', { method: 'post', params: idParam }),
    '/notifications/overdue-reminders': path('Send overdue payment reminders', 'Notifications', { method: 'post' }),
  },
};
