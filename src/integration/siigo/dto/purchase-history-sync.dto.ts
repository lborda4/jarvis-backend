export class StartPurchaseHistorySyncResponseDto {
  jobId: string;
}

export class PurchaseHistorySyncStatusResponseDto {
  status: 'running' | 'completed' | 'error' | null;
  syncedCount: number;
  totalCount: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
}
