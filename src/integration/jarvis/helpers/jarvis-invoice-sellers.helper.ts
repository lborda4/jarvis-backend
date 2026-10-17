import { BadRequestException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
export interface InvoiceSeller { id: string; name: string; }
export async function resolveInvoiceSellers(source: Pick<DataSource, 'query'>, companyId: string, ids?: string[]): Promise<InvoiceSeller[]> {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.length > 30 || ids.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw new BadRequestException('Selecciona vendedores validos (maximo 30).');
  }
  const unique = [...new Set(ids.map(id => id.toLowerCase()))];
  if (!unique.length) return [];
  const sellers: InvoiceSeller[] = await source.query('SELECT id,name FROM jarvis_sellers WHERE company_id=$1 AND id=ANY($2::uuid[])', [companyId, unique]);
  if (sellers.length !== unique.length) throw new BadRequestException('Uno o varios vendedores no pertenecen a esta empresa.');
  return unique.map(id => sellers.find(seller => seller.id === id)!);
}