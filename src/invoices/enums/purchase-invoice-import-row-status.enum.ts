export enum PurchaseInvoiceImportRowStatus {
  PENDING = 'pending',
  /** Reclamada por un worker (ver claimPendingBatch). */
  PROCESSING = 'processing',
  SUCCESS = 'success',
  FAILED = 'failed',
}
