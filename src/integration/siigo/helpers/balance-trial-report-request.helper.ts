import { SiigoTestBalanceByThirdPartyRequest } from '../interfaces/siigo-api.interface';
import { ImportBalanceTrialRequestDto } from '../dto/import-balance-trial-response.dto';

export function buildBalanceTrialReportRequest(
  request?: ImportBalanceTrialRequestDto,
): SiigoTestBalanceByThirdPartyRequest {
  const now = new Date();

  return {
    year: request?.year ?? now.getFullYear(),
    month_start: request?.monthStart ?? 1,
    month_end: request?.monthEnd ?? 13,
    includes_tax_difference: request?.includesTaxDifference ?? false,
    ...(request?.accountStart?.trim()
      ? { account_start: request.accountStart.trim() }
      : {}),
    ...(request?.accountEnd?.trim()
      ? { account_end: request.accountEnd.trim() }
      : {}),
    ...(request?.customer?.trim()
      ? { customer: request.customer.trim() }
      : {}),
  };
}
