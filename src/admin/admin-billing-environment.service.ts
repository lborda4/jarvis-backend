import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { JarvisResolutionKind } from '../integration/jarvis/enums/jarvis-resolution-kind.enum';
import type { JarvisDianResolution } from '../integration/interfaces/integration-credentials.interface';
import { NextPymeApiClient } from '../integration/jarvis/nextpyme/nextpyme-api.client';
import { NextPymeMasterCatalogService } from '../integration/jarvis/nextpyme/nextpyme-master-catalog.service';
import { lockBillingState, withBillingOperation } from '../integration/jarvis/helpers/jarvis-billing-operation';

export const BILLING_TEST_RESOLUTION: JarvisDianResolution = {
  kind: JarvisResolutionKind.ELECTRONIC_INVOICE, documentTypeLabel: 'Factura electrónica de Venta',
  prefix: 'SETP', formNumber: '18760000001', authorizedAt: '2019-01-19',
  technicalKey: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
  fromNumber: 990000000, toNumber: 995000000, nextConsecutive: 990000000,
  dateFrom: '2019-01-19', dateTo: '2030-01-19',
};
type Configuration = { current?: 1 | 2; profiles?: Record<string, JarvisDianResolution>; pending?: boolean; target?: 1 | 2 };

export function selectBillingProfile(configuration: Configuration, active: JarvisDianResolution | undefined, environment: 1 | 2, lastIssued: number) {
  const profiles = { ...configuration.profiles };
  const activeEnvironment = configuration.current ?? (active?.prefix === 'SETP' && active.formNumber === BILLING_TEST_RESOLUTION.formNumber ? 2 : 1);
  if (active) profiles[activeEnvironment] = { ...active };
  const target = environment === 2 ? { ...BILLING_TEST_RESOLUTION,
    nextConsecutive: profiles[2]?.nextConsecutive ?? BILLING_TEST_RESOLUTION.fromNumber } : profiles[1];
  if (!target || target.prefix === 'SETP' || !target.technicalKey?.trim()) {
    if (environment === 1) throw new BadRequestException('Configura primero una resolución de producción de factura electrónica. No hay una resolución anterior para recuperar.');
  }
  if (!target?.prefix || !target.formNumber || !target.authorizedAt || !target.dateFrom || !target.dateTo || !target.technicalKey)
    throw new BadRequestException('La resolución de factura está incompleta. Revisa sus fechas, rango y clave técnica.');
  const nextConsecutive = Math.max(target.fromNumber, target.nextConsecutive ?? target.fromNumber, lastIssued + 1);
  if (!Number.isSafeInteger(nextConsecutive) || nextConsecutive > target.toNumber)
    throw new BadRequestException('Se agotó el rango de la resolución de factura.');
  const resolution = { ...target, nextConsecutive };
  profiles[environment] = resolution;
  return { profiles, resolution };
}

@Injectable()
export class AdminBillingEnvironmentService {
  constructor(private readonly db: DataSource, private readonly api: NextPymeApiClient, private readonly catalogs: NextPymeMasterCatalogService) {}

  private async integration(companyId: string) {
    const [row] = await this.db.query('SELECT credentials FROM integrations WHERE company_id=$1 AND provider=$2 AND active=true', [companyId, IntegrationProvider.JARVIS]);
    if (!row) throw new NotFoundException('La empresa no tiene integración Jarvis activa.');
    return row;
  }

  async status(companyId: string) {
    const integration = await this.integration(companyId);
    const [row] = await this.db.query('SELECT configuration FROM jarvis_billing_environments WHERE company_id=$1', [companyId]);
    const configuration: Configuration = row?.configuration ?? {};
    const active = integration.credentials?.resolutions?.electronic_invoice;
    return { environment: configuration.current ?? null, pending: !!configuration.pending,
      resolution: active ? { prefix: active.prefix, nextConsecutive: active.nextConsecutive ?? active.fromNumber, formNumber: active.formNumber } : null,
      canRestoreProduction: !!configuration.profiles?.[1] || (!!active && active.prefix !== 'SETP') };
  }

  async configure(companyId: string, environment: number) {
    if (environment !== 1 && environment !== 2) throw new BadRequestException('Selecciona Pruebas o Producción.');
    await this.integration(companyId);
    const token = await this.catalogs.requireCompanyToken(companyId);
    return withBillingOperation(this.db, companyId, 'configure', async () => {
      const integration = await this.integration(companyId);
      const active = integration.credentials?.resolutions?.electronic_invoice as JarvisDianResolution | undefined;
      const [row] = await this.db.query('SELECT configuration FROM jarvis_billing_environments WHERE company_id=$1', [companyId]);
      const configuration: Configuration = row?.configuration ?? {};
      const prefix = environment === 2 ? 'SETP' : configuration.profiles?.[1]?.prefix ?? active?.prefix;
      const [history] = await this.db.query(`SELECT COALESCE(MAX(CASE WHEN number ~ '^[0-9]+$' THEN number::numeric
        WHEN LEFT(number,LENGTH($3))=$3 AND SUBSTRING(number FROM LENGTH($3)+1) ~ '^[0-9]+$' THEN SUBSTRING(number FROM LENGTH($3)+1)::numeric END),0)::text AS "lastNumber"
        FROM jarvis_sales_invoices WHERE company_id=$1 AND document_kind=$2 AND prefix=$3`, [companyId, JarvisResolutionKind.ELECTRONIC_INVOICE, prefix ?? '']);
      const lastIssued = Number(history?.lastNumber);
      if (!Number.isSafeInteger(lastIssued) || lastIssued < 0) throw new BadRequestException('No se pudo verificar el consecutivo de este prefijo.');
      const { profiles, resolution } = selectBillingProfile(configuration, active, environment, lastIssued);
      const pending = { ...configuration, profiles, pending: true, target: environment };
      await this.db.query('UPDATE jarvis_billing_environments SET configuration=$2::jsonb,updated_at=now() WHERE company_id=$1', [companyId, JSON.stringify(pending)]);
      try {
        await this.api.configureBillingEnvironment(environment, token);
        const response = await this.api.putConfigResolution({ type_document_id: 1, prefix: resolution.prefix,
          resolution: resolution.formNumber!, resolution_date: resolution.authorizedAt!, technical_key: resolution.technicalKey!,
          from: resolution.fromNumber, to: resolution.toNumber, generated_to_date: 0, date_from: resolution.dateFrom!, date_to: resolution.dateTo! }, token);
        if (response.success === false) throw new BadGatewayException('NextPyme rechazó la resolución de factura.');
        await this.db.transaction(async manager => {
          await lockBillingState(manager, companyId);
          const updated = await manager.query(`UPDATE integrations SET credentials=jsonb_set(COALESCE(credentials,'{}'::jsonb),'{resolutions}',
            COALESCE(credentials->'resolutions','{}'::jsonb) || jsonb_build_object('electronic_invoice',$3::jsonb)),updated_at=now()
            WHERE company_id=$1 AND provider=$2 AND active=true RETURNING id`, [companyId, IntegrationProvider.JARVIS, JSON.stringify(resolution)]);
          if (!updated.length) throw new NotFoundException('La integración Jarvis cambió durante la configuración.');
          await manager.query('UPDATE jarvis_billing_environments SET configuration=$2::jsonb,updated_at=now() WHERE company_id=$1', [companyId, JSON.stringify({ current: environment, profiles, pending: false })]);
        });
        this.catalogs.invalidateResolutionsCache(companyId);
        return this.status(companyId);
      } catch {
        throw new BadGatewayException('No se completó el cambio de ambiente y resolución en NextPyme. La facturación quedó bloqueada para evitar usar una configuración mezclada. Reintenta el cambio desde esta pantalla.');
      }
    });
  }
}
