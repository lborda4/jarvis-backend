import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { DataSource, EntityManager } from 'typeorm';

export async function lockBillingState(manager: EntityManager, companyId: string) {
  await manager.query('INSERT INTO jarvis_billing_environments(company_id) VALUES($1) ON CONFLICT DO NOTHING', [companyId]);
  const [row] = await manager.query('SELECT * FROM jarvis_billing_environments WHERE company_id=$1 FOR UPDATE', [companyId]);
  return row;
}

/** Short DB transactions guard HTTP operations without holding a pooled connection while waiting for NextPyme. */
export async function withBillingOperation<T>(db: DataSource, companyId: string, kind: 'send' | 'configure', work: () => Promise<T>): Promise<T> {
  const id = randomUUID();
  await db.transaction(async manager => {
    const row = await lockBillingState(manager, companyId);
    const operations = row.operations ?? {};
    if (Object.values(operations).includes('configure') || (kind === 'configure' && Object.keys(operations).length))
      throw new ConflictException('Hay un envío o cambio de ambiente de facturación en curso. Espera a que termine.');
    if (kind === 'send' && row.configuration?.pending)
      throw new ConflictException('El cambio de ambiente de facturación quedó incompleto. Un administrador debe reintentar la configuración antes de enviar.');
    await manager.query('UPDATE jarvis_billing_environments SET operations=$2::jsonb,updated_at=now() WHERE company_id=$1', [companyId, JSON.stringify({ ...operations, [id]: kind })]);
  });
  try { return await work(); }
  finally {
    await db.query('UPDATE jarvis_billing_environments SET operations=operations-$2::text,updated_at=now() WHERE company_id=$1', [companyId, id]);
  }
}
