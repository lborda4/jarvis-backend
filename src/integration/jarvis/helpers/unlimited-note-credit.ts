import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Company } from '../../../company/entities/company.entity';
import { Integration } from '../../entities/integration.entity';
import { IntegrationProvider } from '../../enums/integration-provider.enum';
import { jarvisConsumptionStart } from '../../../plan/jarvis-subscription';
import { subscriptionAccess } from '../../../plan/subscription-access';
import { NextPymePackageRejectedException, type NextPymeApiClient } from '../nextpyme/nextpyme-api.client';

const logger = new Logger('UnlimitedNoteCredit');
export type NoteDocumentCreditStatus = 'APPLIED' | 'FAILED' | 'UNCERTAIN' | 'PROCESSING' | 'SKIPPED';

/** Only call after a confirmed note emission. Never retry an uncertain external credit. */
export async function creditUnlimitedNote(db: DataSource, api: NextPymeApiClient, companyId: string,
  noteKey: string, issuedAt = new Date()): Promise<NoteDocumentCreditStatus> {
  let claimed = false;
  let status: NoteDocumentCreditStatus = 'FAILED';
  try {
    const rows = await db.query(`INSERT INTO jarvis_note_document_credits(company_id,note_key,status)
      VALUES($1,$2,'PROCESSING') ON CONFLICT DO NOTHING RETURNING status`, [companyId, noteKey]);
    if (!rows.length) {
      const [existing] = await db.query('SELECT status FROM jarvis_note_document_credits WHERE company_id=$1 AND note_key=$2', [companyId, noteKey]);
      return existing?.status ?? 'UNCERTAIN';
    }
    claimed = true;
    const integrations = db.getRepository(Integration);
    const integration = await integrations.findOne({ where: { companyId, provider: IntegrationProvider.JARVIS }, relations: { plan: true, company: true } })
      ?? await integrations.findOne({ where: { companyId, provider: IntegrationProvider.SIIGO }, relations: { plan: true, company: true } });
    // A delayed confirmation must not credit an expired subscription or its next cycle.
    if (!integration || !subscriptionAccess(integration).canWrite || (integration.provider === IntegrationProvider.JARVIS && issuedAt < jarvisConsumptionStart(integration))) status = 'SKIPPED';
    else {
      const companies = db.getRepository(Company);
      const company = integration.company ?? await companies.findOne({ where: { id: companyId } });
      const issuer = await companies.findOne({ where: { nit: '902086460' } });
      const token = issuer?.nextPymeToken?.trim();
      const nit = String(company?.nit ?? '').split('-')[0].replace(/\D/g, '');
      const identification = Number(nit);
      if (!token || !nit || !Number.isSafeInteger(identification) || identification <= 0)
        throw new Error('Falta configurar el token emisor o el NIT de la empresa.');
      const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(',', '');
      // The existing recharge endpoint requires the platform issuer token and the target company NIT.
      status = 'UNCERTAIN';
      try {
        await api.assignDocumentPackage({ user_identification_number: identification,
          absolut_start_plan_date: date, absolut_documents: 1 }, token);
        status = 'APPLIED';
      } catch (error) {
        if (error instanceof NextPymePackageRejectedException) status = 'FAILED';
      }
    }
    await db.query('UPDATE jarvis_note_document_credits SET status=$3,completed_at=now() WHERE company_id=$1 AND note_key=$2', [companyId, noteKey, status]);
  } catch {
    // Never turn an emitted note into a failed send, or repeat a potentially applied credit.
    if (claimed) {
      try { await db.query('UPDATE jarvis_note_document_credits SET status=$3,completed_at=now() WHERE company_id=$1 AND note_key=$2', [companyId, noteKey, status]); } catch { /* PROCESSING remains reserved for manual reconciliation. */ }
    }
  }
  if (status !== 'APPLIED' && status !== 'SKIPPED') logger.error(`Abono de nota pendiente de revisión company=${companyId} note=${noteKey} status=${status}`);
  return status;
}
