import type { PayrollWorker } from './payroll-domain';

/** Refresh correctable registration/payment fields without recalculating historical pay. */
export function payrollSubmissionWorker(snapshot: PayrollWorker, current: Partial<PayrollWorker> & { contractType?: string }) {
  const worker: PayrollWorker & { contractType?: string } = { ...snapshot };
  const fields = ['workerCode', 'email', 'address', 'municipalityId', 'documentTypeId', 'typeWorkerId', 'subTypeWorkerId',
    'contractType', 'typeContractId', 'paymentMethodId', 'paymentMethodType', 'bankName', 'accountType', 'accountNumber'] as const;
  for (const field of fields) if (Object.prototype.hasOwnProperty.call(current, field))
    (worker as unknown as Record<string, unknown>)[field] = current[field];
  return worker;
}
