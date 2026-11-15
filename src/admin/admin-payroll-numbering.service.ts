import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { NextPymeApiClient, type NextPymePayrollResolution } from '../integration/jarvis/nextpyme/nextpyme-api.client';
import { NextPymeMasterCatalogService } from '../integration/jarvis/nextpyme/nextpyme-master-catalog.service';
import { ensurePayrollNumbering, PAYROLL_RANGE_TO } from '../payroll/payroll-numbering';

export const PAYROLL_REGISTRATION_RANGES = [
  { type_document_id: 9 as const, prefix: 'NI' as const, from: 1, to: PAYROLL_RANGE_TO },
  { type_document_id: 10 as const, prefix: 'NA' as const, from: 1, to: PAYROLL_RANGE_TO },
];

export function payrollRegistrationStatus(remote: NextPymePayrollResolution[], local?: { next_number?: string | number; next_note_number?: string | number }) {
  const ranges = PAYROLL_REGISTRATION_RANGES.map(expected => {
    const matches = remote.filter(row => row.prefix === expected.prefix && row.typeDocumentId === expected.type_document_id);
    const row = matches[0];
    const issue = matches.length > 1 ? 'Hay más de un rango para este tipo y prefijo. Revisa su configuración en NextPyme.'
      : row && (row.from !== expected.from || row.to !== expected.to) ? 'El rango registrado es distinto de 1–99999999. Revisa su configuración en NextPyme.'
      : row && (row.nextConsecutive === null || !Number.isSafeInteger(row.nextConsecutive) || row.nextConsecutive < 1 || row.nextConsecutive > PAYROLL_RANGE_TO + 1) ? 'No se pudo verificar el siguiente consecutivo registrado en NextPyme.' : null;
    const saved = Number(expected.prefix === 'NI' ? local?.next_number ?? 1 : local?.next_note_number ?? 1);
    if (!Number.isSafeInteger(saved) || saved < 1) throw new BadRequestException('El consecutivo local de nómina es inválido. Revisa la numeración antes de continuar.');
    return { typeDocumentId: expected.type_document_id, prefix: expected.prefix, from: expected.from, to: expected.to,
      configured: !!row && !issue, nextConsecutive: Math.max(saved, row?.nextConsecutive ?? 1), issue };
  });
  return { complete: ranges.every(range => range.configured), ranges };
}

@Injectable()
export class AdminPayrollNumberingService {
  constructor(private readonly db: DataSource, private readonly api: NextPymeApiClient, private readonly catalogs: NextPymeMasterCatalogService) {}

  private async token(companyId: string) {
    const [row] = await this.db.query("SELECT id FROM integrations WHERE company_id=$1 AND provider='JARVIS' AND active=true", [companyId]);
    if (!row) throw new NotFoundException('La empresa no tiene integración Jarvis activa.');
    return this.catalogs.requireCompanyToken(companyId);
  }
  private async local(companyId: string) {
    const [row] = await this.db.query('SELECT next_number,next_note_number FROM jarvis_payroll_settings WHERE company_id=$1', [companyId]);
    return row;
  }
  async status(companyId: string) {
    const token = await this.token(companyId);
    return payrollRegistrationStatus(await this.api.getConfiguredPayrollResolutions(token), await this.local(companyId));
  }
  async configure(companyId: string) {
    const token = await this.token(companyId);
    const remote = await this.api.getConfiguredPayrollResolutions(token);
    const before = payrollRegistrationStatus(remote, await this.local(companyId));
    const issues = before.ranges.filter(range => range.issue);
    if (issues.length) throw new BadRequestException(issues.map(range => `${range.prefix}: ${range.issue}`).join(' | '));
    const registered: string[] = [];
    const applied: string[] = [];
    for (const expected of PAYROLL_REGISTRATION_RANGES) {
      const found = remote.find(row => row.prefix === expected.prefix && row.typeDocumentId === expected.type_document_id);
      const payload = found ? { ...found.configuration, type_document_id: expected.type_document_id,
        prefix: expected.prefix, from: found.from, to: found.to } : expected;
      try {
        await this.api.configurePayrollResolution(payload, token);
        applied.push(expected.prefix);
        if (!found) registered.push(expected.prefix);
      } catch {
        throw new BadGatewayException(`No se pudo aplicar la configuraci\u00f3n de ${expected.prefix} en NextPyme. Vuelve a consultar y reintenta el env\u00edo de NI y NA.`);
      }
    }
    const confirmedRemote = await this.api.getConfiguredPayrollResolutions(token);
    const confirmed = payrollRegistrationStatus(confirmedRemote);
    if (!confirmed.complete) throw new BadGatewayException('NextPyme aún no confirma ambos rangos NI y NA. Vuelve a consultar antes de reintentar.');
    await this.db.transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`payroll:${companyId}`]);
      await ensurePayrollNumbering(manager, companyId);
      await manager.query(`UPDATE jarvis_payroll_settings SET next_number=GREATEST(next_number,$2),
        next_note_number=GREATEST(next_note_number,$3),settings=settings || '{"payrollNumberingConfigured":true}'::jsonb,updated_at=now() WHERE company_id=$1`,
        [companyId, Math.max(before.ranges[0].nextConsecutive, confirmed.ranges[0].nextConsecutive), Math.max(before.ranges[1].nextConsecutive, confirmed.ranges[1].nextConsecutive)]);
    });
    return { ...payrollRegistrationStatus(confirmedRemote, await this.local(companyId)), registered, applied };
  }
}
