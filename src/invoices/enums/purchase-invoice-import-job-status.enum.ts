export enum PurchaseInvoiceImportJobStatus {
  /** Job creado, todavía no arrancó a procesar filas (ventana muy corta entre crear el job y que el background lo tome). */
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  ERROR = 'error',
}
