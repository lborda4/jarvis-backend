import { ServiceUnavailableException } from '@nestjs/common';
import type { NextPymeMasterRow } from '../nextpyme/nextpyme-api.client';

export function terceroPaymentMethods(rows: NextPymeMasterRow[]) {
  const normalize = (name: string) =>
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z]/g, '');
  const presets = [
    { code: '10', name: 'Efectivo', names: ['efectivo'] },
    // NextPyme normally assigns ID 42 to the DIAN bank transfer code 30.
    {
      code: '30',
      name: 'Consignación bancaria',
      names: [
        'consignacionbancaria',
        'transferenciacredito',
        'transfereciacredito',
      ],
    },
  ];
  const items = presets.map((preset) => {
    const candidates = rows.filter(
      (row) => String(row.code ?? '').trim() === preset.code,
    );
    const matches = candidates.length
      ? candidates
      : rows.filter(
          (row) => !row.code && preset.names.includes(normalize(row.name)),
        );
    if (
      matches.length !== 1 ||
      !Number.isSafeInteger(matches[0].id) ||
      matches[0].id < 1
    )
      throw new ServiceUnavailableException(
        'No se pudo obtener el método de pago ' +
          preset.name +
          ' de NextPyme. Intenta nuevamente.',
      );
    return { id: matches[0].id, code: preset.code, name: preset.name };
  });
  if (items[0].id === items[1].id)
    throw new ServiceUnavailableException(
      'Los métodos de pago de NextPyme no son válidos.',
    );
  return items;
}
