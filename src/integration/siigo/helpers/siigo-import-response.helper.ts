import { SiigoImportValidationStatus } from '../enums/siigo-import-validation-status.enum';
import { ValidateSiigoImportResponseDto } from '../dto/validate-siigo-import.dto';

export function buildSiigoImportResponse(params: {
  status: SiigoImportValidationStatus;
  supplierConfigurationId?: string | null;
  supplierDocument?: string;
  supplierName: string | null;
  autoApply?: boolean;
  accountCode?: string | null;
  message?: string;
}): ValidateSiigoImportResponseDto {
  return {
    status: params.status,
    supplierConfigurationId: params.supplierConfigurationId ?? null,
    supplierDocument: params.supplierDocument ?? '',
    supplierName: params.supplierName,
    autoApply: params.autoApply ?? false,
    accountCode: params.accountCode ?? null,
    ...(params.message ? { message: params.message } : {}),
  };
}
