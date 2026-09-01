export class SuggestedRetentionDto {
  id: number;
  name: string;
  type: string;
  percentage: number;
}

export class SuggestPurchaseItemClassificationResponseDto {
  accountCode: string | null;
  accountName: string | null;
  taxId: number | null;
  taxName: string | null;
  taxPercentage: number | null;
  retentionSuggestions: SuggestedRetentionDto[];
}
