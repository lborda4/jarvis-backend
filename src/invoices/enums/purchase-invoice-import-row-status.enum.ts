export enum PurchaseInvoiceImportRowStatus {
  PENDING = 'pending',
  /** Reclamada por un worker (ver claimPendingBatch) — si queda en este
   * estado más de PURCHASE_INVOICE_PROCESSING_TIMEOUT_MINUTES, se
   * considera abandonada y vuelve a 'pending'. */
  PROCESSING = 'processing',
  SUCCESS = 'success',
  FAILED = 'failed',
}
