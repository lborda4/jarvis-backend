import { SiigoTestBalanceReportRequest } from '../interfaces/siigo-api.interface';
import { ImportBalanceTrialRequestDto } from '../dto/import-balance-trial-response.dto';
import { BALANCE_TRIAL_YEARS_COUNT } from '../constants/supplier-configuration.constants';

function buildBalanceTrialReportRequestForYear(
  year: number,
  request?: ImportBalanceTrialRequestDto,
): SiigoTestBalanceReportRequest {
  return {
    year,
    month_start: request?.monthStart ?? 1,
    month_end: request?.monthEnd ?? 13,
    includes_tax_difference: request?.includesTaxDifference ?? false,
    ...(request?.accountStart?.trim()
      ? { account_start: request.accountStart.trim() }
      : {}),
    ...(request?.accountEnd?.trim()
      ? { account_end: request.accountEnd.trim() }
      : {}),
  };
}

export function buildBalanceTrialReportRequestForCurrentMonth(
  referenceDate = new Date(),
): SiigoTestBalanceReportRequest {
  const month = referenceDate.getMonth() + 1;

  return {
    year: referenceDate.getFullYear(),
    month_start: month,
    month_end: month,
    includes_tax_difference: false,
  };
}

export function buildBalanceTrialAutoSyncReportRequests(
  referenceDate = new Date(),
): SiigoTestBalanceReportRequest[] {
  const previousMonthDate = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth() - 1,
    1,
  );

  return [
    buildBalanceTrialReportRequestForCurrentMonth(previousMonthDate),
    buildBalanceTrialReportRequestForCurrentMonth(referenceDate),
  ];
}

export function buildBalanceTrialReportRequests(
  request?: ImportBalanceTrialRequestDto,
): SiigoTestBalanceReportRequest[] {
  const endYear = request?.year ?? new Date().getFullYear();
  const yearsCount = Math.max(1, BALANCE_TRIAL_YEARS_COUNT);
  const startYear = endYear - (yearsCount - 1);
  const requests: SiigoTestBalanceReportRequest[] = [];

  for (let year = startYear; year <= endYear; year += 1) {
    requests.push(buildBalanceTrialReportRequestForYear(year, request));
  }

  return requests;
}
