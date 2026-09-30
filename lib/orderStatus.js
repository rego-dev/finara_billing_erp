// Shared label/badge-class map for BusinessOrder statuses. Used by the My
// Businesses page (customer's own orders) and the business detail modal
// (a business's order/payment history) so both stay in sync.
export const STATUS = {
  PENDING_PAYMENT: { label: 'Awaiting payment', cls: 'badge-yellow' },
  PROOF_SUBMITTED: { label: 'Under review',     cls: 'badge-blue' },
  APPROVED:        { label: 'Approved',         cls: 'badge-green' },
  REJECTED:        { label: 'Rejected',         cls: 'badge-red' },
  CANCELLED:       { label: 'Cancelled',        cls: 'badge' },
};
