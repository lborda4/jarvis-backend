import { BadRequestException } from '@nestjs/common';

export function advisorCommission(type: unknown, value: unknown): { commissionType: 'FIXED' | 'PERCENT'; commissionValue: string | null } {
  if (type !== 'FIXED' && type !== 'PERCENT') throw new BadRequestException('Selecciona comisión fija en COP o porcentaje.');
  if (value === null || value === undefined) return { commissionType: type, commissionValue: null };
  const max = type === 'PERCENT' ? 100 : 999999999999.99;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || Math.abs(Math.round(value * 100) / 100 - value) > 0.0000001)
    throw new BadRequestException(type === 'PERCENT' ? 'El porcentaje debe estar entre 0 y 100, con hasta dos decimales.' : 'Indica una comisión en COP válida, con hasta dos decimales.');
  return { commissionType: type, commissionValue: value.toFixed(2) };
}
