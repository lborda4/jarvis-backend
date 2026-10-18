import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { JarvisInvoiceAttachmentsController } from './jarvis-invoice-attachments.controller';
import { JarvisInvoiceDraftsController } from './jarvis-invoice-drafts.controller';
import { loadDraftAttachment } from './helpers/jarvis-invoice-attachment.helper';

// Explicit opt-in only. Every write stays inside a transaction that is rolled back.
const integration = process.env.JARVIS_ATTACHMENT_DB_TEST === '1' ? describe : describe.skip;
integration('adjuntos en PostgreSQL (rollback)', () => {
  it('conserva el archivo al reabrir, editar y retirar el borrador, y aísla empresas', async () => {
    const db = require('../../config/data-source').default as import('typeorm').DataSource;
    db.setOptions({ synchronize: false, migrationsRun: false, logging: false });
    await db.initialize();
    const runner = db.createQueryRunner();
    const id = randomUUID(), invoiceId = randomUUID();
    try {
      await runner.connect();
      await runner.startTransaction();
      const [company] = await runner.query('SELECT id FROM companies ORDER BY id LIMIT 1');
      if (!company) throw new Error('Se requiere una empresa para la prueba.');
      const user = { companyId: company.id } as AuthenticatedUser;
      const other = { companyId: randomUUID() } as AuthenticatedUser;
      const source = { query: (sql: string, params?: unknown[]) => runner.query(sql, params) };
      const attachments = new JarvisInvoiceAttachmentsController(source as never);
      const drafts = new JarvisInvoiceDraftsController(source as never);
      const bytes = Buffer.from('%PDF-1.7\n' + 'Archivo de prueba\n'.repeat(10000) + '%%EOF');
      const file = { originalname: 'soporte.pdf', buffer: bytes, mimetype: 'application/pdf' } as Express.Multer.File;
      await drafts.save(user, id, { documentKind: 'ELECTRONIC_INVOICE', state: { notes: 'Original', lines: [] } });
      await attachments.save(user, id, 'ELECTRONIC_INVOICE', file);
      const reopened = (await drafts.get(user, id)).draft;
      expect(reopened.state).toEqual({ notes: 'Original', lines: [], attachment: { name: 'soporte.pdf', mimeType: 'application/pdf', size: bytes.length } });
      expect((await attachments.draft(user, id)).getStream().read()).toEqual(bytes);
      await drafts.save(user, id, { documentKind: 'ELECTRONIC_INVOICE', state: { notes: 'Editado', lines: [] } });
      expect((await drafts.get(user, id)).draft.state.notes).toBe('Editado');
      expect((await attachments.draft(user, id)).getStream().read()).toEqual(bytes);
      await expect(attachments.draft(other, id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(loadDraftAttachment(source as never, company.id, 'CREDIT_NOTE', id)).rejects.toBeInstanceOf(NotFoundException);
      const attachment = await loadDraftAttachment(source as never, company.id, 'ELECTRONIC_INVOICE', id);
      await runner.query(`INSERT INTO jarvis_sales_invoices
        (id,company_id,document_kind,provider_id,prefix,number,issue_date,customer_name,customer_identification,currency,total,source_request)
        VALUES ($1,$2,'ELECTRONIC_INVOICE','test','TESTATT',$3,'2199-01-01','Prueba','0','COP',1,$4::jsonb)`,
        [invoiceId, company.id, invoiceId, JSON.stringify({ attachment })]);
      await attachments.remove(user, id);
      await expect(attachments.draft(user, id)).rejects.toBeInstanceOf(NotFoundException);
      await drafts.remove(user, id);
      expect((await attachments.invoice(user, invoiceId)).getStream().read()).toEqual(bytes);
      await expect(attachments.invoice(other, invoiceId)).rejects.toBeInstanceOf(NotFoundException);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      try {
        const [remaining] = await db.query('SELECT (SELECT count(*) FROM jarvis_invoice_drafts WHERE id=$1) + (SELECT count(*) FROM jarvis_sales_invoices WHERE id=$2) AS count', [id, invoiceId]);
        expect(Number(remaining.count)).toBe(0);
      } finally { await db.destroy(); }
    }
  }, 60000);
});
