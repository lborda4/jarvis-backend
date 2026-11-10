interface PaymentMethod {
  id: number;
  name?: string;
  code?: string | null;
}

export function employeePaymentType(
  id: number,
  methods: PaymentMethod[] = [],
): 'cash' | 'transfer' | undefined {
  const method = methods.find((method) => method.id === id);
  if (!method) return undefined;
  const code = String(method.code ?? '').trim();
  if (code === '10') return 'cash';
  if (code === '30') return 'transfer';
  const name = (method.name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (name === 'efectivo') return 'cash';
  if (
    /^(consignacionbancaria|transferenciacredito|transfereciacredito|transferenciabancaria)$/.test(
      name,
    )
  )
    return 'transfer';
  return undefined;
}

export function employeeBankFields(
  employee: { bankName?: string; accountType?: string; accountNumber?: string },
  type?: 'cash' | 'transfer',
) {
  return type === 'transfer'
    ? {
        bankName: employee.bankName?.trim() ?? '',
        accountType: employee.accountType?.trim().toUpperCase() ?? '',
        accountNumber: employee.accountNumber?.trim() ?? '',
      }
    : { bankName: '', accountType: '', accountNumber: '' };
}

interface BankWorker {
  paymentMethodId: number;
  paymentMethodType?: 'cash' | 'transfer';
  bankName?: string;
  accountType?: string;
  accountNumber?: string;
}
export function workerPaymentType(worker: BankWorker) {
  // Legacy snapshots used the standard master IDs before recording their resolved type.
  return (
    worker.paymentMethodType ??
    (worker.paymentMethodId === 10
      ? 'cash'
      : worker.paymentMethodId === 42
        ? 'transfer'
        : undefined)
  );
}
export function employeeBankErrors(worker: BankWorker) {
  if (workerPaymentType(worker) === 'cash') return [];
  if (workerPaymentType(worker) !== 'transfer' && !worker.bankName) return [];
  const errors: string[] = [];
  if (typeof worker.bankName !== 'string' || !worker.bankName.trim())
    errors.push('Completa el nombre del banco del empleado.');
  if (
    typeof worker.accountType !== 'string' ||
    !['AHORROS', 'CORRIENTE'].includes(worker.accountType.trim().toUpperCase())
  )
    errors.push(
      'Selecciona AHORROS o CORRIENTE como tipo de cuenta del empleado.',
    );
  if (
    typeof worker.accountNumber !== 'string' ||
    !/^\d+$/.test(worker.accountNumber.trim())
  )
    errors.push('Completa el número de cuenta del empleado con solo números.');
  return errors;
}
