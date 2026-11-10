import { BadRequestException } from '@nestjs/common';
import type { NextPymeMasterRow } from '../nextpyme/nextpyme-api.client';

const names: Record<string, string[]> = {
  INDEFINITE: ['terminoindefinido', 'aterminoindefinido', 'indefinido'],
  FIXED: ['terminofijo', 'aterminofijo', 'fijo'],
  WORK: [
    'obraolabor',
    'obralabor',
    'porobraolabor',
    'obraolabordeterminada',
    'duraciondeobraolabor',
    'duraciondelaobraolabor',
    'duracionobraolabor',
    'duraciondeobralabor',
    'porduraciondelaobraolabor',
  ],
  APPRENTICE: ['aprendizaje', 'contratodeaprendizaje', 'contratoaprendizaje'],
  OCCASIONAL: [
    'ocasional',
    'ocasionalaccidentalotransitorio',
    'ocasionalaccidentaltransitorio',
    'otro',
    'otros',
  ],
};
const normalize = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/^contrato(de)?/, '');
export function payrollContractOptions(rows: NextPymeMasterRow[]) {
  return Object.entries(names).flatMap(([key, aliases]) => {
    const matches = rows.filter(
      (row) =>
        Number.isSafeInteger(row.id) &&
        row.id > 0 &&
        aliases.includes(normalize(row.name)),
    );
    // A missing or ambiguous mapping must never guess a provider ID.
    return matches.length === 1
      ? [
          {
            key,
            id: matches[0].id,
            name: matches[0].name,
            code: matches[0].code ?? null,
          },
        ]
      : [];
  });
}
export function resolvePayrollContractId(
  key: string,
  options: ReturnType<typeof payrollContractOptions> = [],
  requestedId?: number,
) {
  const option = options.find((option) => option.key === key);
  if (!option)
    throw new BadRequestException(
      'El tipo de contrato no está homologado en type_contracts de NextPyme. Actualiza el catálogo y selecciona un contrato disponible.',
    );
  if (requestedId !== undefined && requestedId !== option.id)
    throw new BadRequestException(
      'El ID de tipo de contrato no corresponde al contrato seleccionado en NextPyme.',
    );
  return option.id;
}
