import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { JarvisInvoiceDraftsController } from './jarvis-invoice-drafts.controller';

const integration = process.env.JARVIS_ATTACHMENT_DB_TEST === '1' ? describe : describe.skip;
integration('reserva de factura importada en PostgreSQL (rollback)', () => {
  it('reserva una sola vez, bloquea cambios y conserva la confirmación', async () => {
    const db = require('../../config/data-source').default as import('typeorm').DataSource;
    db.setOptions({ synchronize: false, migrationsRun: false, logging: false });
    await db.initialize();
    const runner = db.createQueryRunner();
    try {
      await runner.connect();
      await runner.startTransaction();
      const [company] = await runner.query('SELECT id FROM companies ORDER BY id LIMIT 1');
      if (!company) throw new Error('Se requiere una empresa para la prueba.');
      const user = { companyId: company.id } as AuthenticatedUser;
      const other = { companyId: randomUUID() } as AuthenticatedUser;
      const controller = new JarvisInvoiceDraftsController({ query: (sql: string, params?: unknown[]) => runner.query(sql, params) } as never);
      const id = randomUUID();
      const state = { importSource: 'sales-excel-v1', importReference: 'test', lines: [] };
      await controller.save(user, id, { documentKind: 'ELECTRONIC_INVOICE', state });
      await expect(controller.claimSalesImport(other, id, { state })).rejects.toBeInstanceOf(ConflictException);
      await expect(controller.claimSalesImport(user, id, { state: { ...state, lines: [1] } })).rejects.toBeInstanceOf(ConflictException);
      const { token } = await controller.claimSalesImport(user, id, { state });
      await expect(controller.claimSalesImport(user, id, { state })).rejects.toBeInstanceOf(ConflictException);
      await expect(controller.save(user, id, { documentKind: 'ELECTRONIC_INVOICE', state })).rejects.toBeInstanceOf(NotFoundException);
      await expect(controller.remove(user, id)).rejects.toBeInstanceOf(ConflictException);
      await controller.completeSalesImport(user, id, { token, invoiceId: randomUUID() });
      expect((await controller.get(user, id)).draft.state.importDelivery.status).toBe('sent');
      await expect(controller.completeSalesImport(user, id, { token })).rejects.toBeInstanceOf(ConflictException);
      await expect(controller.remove(user, id)).rejects.toBeInstanceOf(ConflictException);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await db.destroy();
    }
  }, 60000);
});
