import { ServiceUnavailableException } from '@nestjs/common';
import type { NextPymeMasterRow } from '../integration/jarvis/nextpyme/nextpyme-api.client';

export interface PayrollPaymentMethod {
  id: string;
  name: string;
  systemKey: 'cash' | 'transfer' | null;
  nextpymeMethodId: number;
  nextpymeMethodName: string;
}

export const payrollPaymentColumns = 'id, name, system_key AS "systemKey", nextpyme_method_id AS "nextpymeMethodId", nextpyme_method_name AS "nextpymeMethodName"';
export const payrollPaymentPresets = [
  { systemKey: 'cash' as const, name: 'Efectivo', code: '10', masterName: 'efectivo' },
  { systemKey: 'transfer' as const, name: 'Transferencia bancaria', code: '30', masterName: 'transferenciacredito' },
];

export function payrollPaymentMaster(catalog: NextPymeMasterRow[], preset: typeof payrollPaymentPresets[number]) {
  const normalize = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const master = catalog.find(row => String(row.code ?? '').trim() === preset.code)
    ?? catalog.find(row => normalize(row.name) === preset.masterName || (preset.systemKey === 'transfer' && normalize(row.name) === 'transfereciacredito'));
  if (!master) throw new ServiceUnavailableException('No se pudo obtener el medio de pago ' + preset.name + '. Intenta nuevamente.');
  return master;
}
