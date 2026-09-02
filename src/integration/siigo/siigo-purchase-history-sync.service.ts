import { Injectable, Logger } from '@nestjs/common';
import { mapWithConcurrency } from '../../common/helpers/concurrency.helper';
import { HistorialFacturaFuente } from '../enums/historial-factura-fuente.enum';
import { HistorialFacturaTipo } from '../enums/historial-factura-tipo.enum';
import { SiigoPurchaseSyncJobStatus } from '../enums/siigo-purchase-sync-job-status.enum';
import { SIIGO_DEFAULT_ITEM_TYPE } from './constants/supplier-configuration.constants';
import { SiigoPurchaseSyncJob } from '../entities/siigo-purchase-sync-job.entity';
import { HistorialFactura } from '../entities/historial-factura.entity';
import { SupplierConfiguration } from '../entities/supplier-configuration.entity';
import {
  HistorialFacturaImpuestoCampo,
  HistorialFacturaImpuestoCampoGroup,
  HistorialFacturasRepository,
} from '../repositories/historial-facturas.repository';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { SiigoPurchaseSyncJobsRepository } from '../repositories/siigo-purchase-sync-jobs.repository';
import { SupplierConfigurationsRepository } from '../repositories/supplier-configurations.repository';
import { SiigoHttpClient } from './clients/siigo-http.client';
import {
  buildTaxCatalogById,
  classifySiigoPurchaseTaxes,
  mapImpuestosToRetentionPreferences,
  mapSiigoItemTypeToHistorialTipo,
} from './helpers/siigo-purchase-tax-classification.helper';
import {
  getSiigoIntegration,
  normalizeSupplierDocument,
} from './helpers/siigo-context.helper';
import { isSiigoServiceUnavailableApiError } from './helpers/siigo-error.helper';
import { executeSiigoRequestWithRetries } from './helpers/siigo-request-retry.helper';
import {
  SiigoPurchaseResponse,
  SiigoPurchasesListResponse,
} from './interfaces/siigo-api.interface';
import { SiigoAuthService } from './siigo-auth.service';
import { SiigoPaymentTypesCatalogService } from './siigo-payment-types-catalog.service';
import { SiigoTaxesCatalogService } from './siigo-taxes-catalog.service';
import { HistorialFacturaTaxDetail } from '../interfaces/historial-factura-impuestos.interface';
import { SupplierFieldVariability } from '../interfaces/supplier-field-variability.interface';

const SYNC_PAGE_SIZE = 100;
/** Tope de seguridad: nunca deberíamos acercarnos a esto con page_size=100. */
const SYNC_MAX_PAGES = 500;
const SYNC_HISTORY_YEARS = 2;
/** Páginas de SIIGO a traer en simultáneo (lecturas, no creaciones — más agresivo que el throttle de envíos). */
const SYNC_PAGE_FETCH_CONCURRENCY = 5;
/** ≥70% del historial de UN campo puntual (líneas o facturas, según el
 * campo) coincide en el mismo valor ⇒ ese campo se marca fijo y se
 * autocompleta en el front. Por debajo de este umbral se marca variable y
 * el campo queda en blanco para que el contador lo resuelva con el dato de
 * la transacción actual. Cada campo (cuenta, tipo, medio de pago, cada
 * categoría de impuesto) se evalúa de forma independiente contra este mismo
 * umbral — ver SupplierFieldVariability. */
const VARIABILITY_THRESHOLD = 0.7;

/** Categorías de impuesto que se evalúan por variabilidad de forma
 * independiente entre sí (y de la cuenta contable). */
const IMPUESTO_CAMPOS: readonly HistorialFacturaImpuestoCampo[] = [
  'iva',
  'retefuente',
  'reteica',
  'autorretencion',
];

interface DominantGroup {
  proveedorNit: string;
  count: number;
}

interface DominantGroupsResult<G extends DominantGroup> {
  bestByProveedor: Map<string, G>;
  totalsByProveedor: Map<string, number>;
}

/** Para cada proveedor, encuentra el grupo con más ocurrencias (`count`) y
 * suma el total de ocurrencias de TODOS sus grupos — la base para decidir,
 * campo por campo, si ese proveedor es "fijo" (el grupo ganador cubre
 * ≥VARIABILITY_THRESHOLD del total) o "variable". */
function pickDominantGroups<G extends DominantGroup>(
  groups: G[],
): DominantGroupsResult<G> {
  const totalsByProveedor = new Map<string, number>();
  const bestByProveedor = new Map<string, G>();

  for (const group of groups) {
    totalsByProveedor.set(
      group.proveedorNit,
      (totalsByProveedor.get(group.proveedorNit) ?? 0) + group.count,
    );

    const current = bestByProveedor.get(group.proveedorNit);

    if (!current || group.count > current.count) {
      bestByProveedor.set(group.proveedorNit, group);
    }
  }

  return { bestByProveedor, totalsByProveedor };
}

function isFieldFixed(bestCount: number, total: number): boolean {
  return total > 0 && bestCount / total >= VARIABILITY_THRESHOLD;
}

@Injectable()
export class SiigoPurchaseHistorySyncService {
  private readonly logger = new Logger(SiigoPurchaseHistorySyncService.name);

  constructor(
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoHttpClient: SiigoHttpClient,
    private readonly siigoTaxesCatalogService: SiigoTaxesCatalogService,
    private readonly siigoPaymentTypesCatalogService: SiigoPaymentTypesCatalogService,
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly historialFacturasRepository: HistorialFacturasRepository,
    private readonly siigoPurchaseSyncJobsRepository: SiigoPurchaseSyncJobsRepository,
    private readonly supplierConfigurationsRepository: SupplierConfigurationsRepository,
  ) {}

  /**
   * Si ya hay un sync 'running' para esta empresa, reutiliza ese job en vez
   * de crear uno nuevo en paralelo — evita duplicar el trabajo (y las
   * llamadas a SIIGO) cuando el botón que lo dispara se puede pulsar más de
   * una vez (ej. el wizard de configuración lo llama junto con el sync de
   * Balance de Prueba, y el usuario puede reintentar ese paso).
   */
  async startSync(companyId: string): Promise<{ jobId: string }> {
    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );

    const latestJob =
      await this.siigoPurchaseSyncJobsRepository.findLatestByCompany(
        companyId,
        integration.id,
      );

    if (latestJob?.status === SiigoPurchaseSyncJobStatus.RUNNING) {
      return { jobId: latestJob.id };
    }

    const job = await this.siigoPurchaseSyncJobsRepository.save(
      this.siigoPurchaseSyncJobsRepository.create({
        companyId,
        integrationId: integration.id,
      }),
    );

    void this.runSync(job.id, companyId, integration.id);

    return { jobId: job.id };
  }

  getLatestStatus(companyId: string): Promise<SiigoPurchaseSyncJob | null> {
    return getSiigoIntegration(this.integrationsRepository, companyId).then(
      (integration) =>
        this.siigoPurchaseSyncJobsRepository.findLatestByCompany(
          companyId,
          integration.id,
        ),
    );
  }

  private async runSync(
    jobId: string,
    companyId: string,
    integrationId: string,
  ): Promise<void> {
    try {
      const taxesCatalog = await this.siigoTaxesCatalogService.listTaxes(
        {},
        companyId,
      );
      const taxCatalogById = buildTaxCatalogById(taxesCatalog);
      const cutoffDate = this.buildCutoffDate();

      // Página 1 aparte: hace falta para saber total_results antes de poder
      // paralelizar el resto.
      const firstPage = await this.fetchPage(companyId, 1);
      const totalResults = firstPage.pagination?.total_results ?? 0;
      const totalPages = Math.max(1, Math.ceil(totalResults / SYNC_PAGE_SIZE));

      await this.updateJob(jobId, { totalCount: totalResults });

      let syncedCount = await this.persistPageBatch(
        companyId,
        integrationId,
        firstPage.results ?? [],
        cutoffDate,
        taxCatalogById,
      );
      await this.updateJob(jobId, { syncedCount });

      if (totalPages > 1) {
        const remainingPages = Array.from(
          { length: totalPages - 1 },
          (_, index) => index + 2,
        );

        await mapWithConcurrency(
          remainingPages,
          SYNC_PAGE_FETCH_CONCURRENCY,
          async (page) => {
            const response = await this.fetchPage(companyId, page);
            const pageSynced = await this.persistPageBatch(
              companyId,
              integrationId,
              response.results ?? [],
              cutoffDate,
              taxCatalogById,
            );

            syncedCount += pageSynced;
            await this.updateJob(jobId, { syncedCount });
          },
        );
      }

      await this.recomputeSupplierSummaries(companyId, integrationId);
      // syncedCount se repite acá (además de las actualizaciones intermedias)
      // porque esas pueden pisarse entre sí si dos páginas terminan casi a
      // la vez (mismo job, updates concurrentes) — esta es la definitiva,
      // ya con mapWithConcurrency totalmente resuelto.
      await this.updateJob(jobId, {
        status: SiigoPurchaseSyncJobStatus.COMPLETED,
        syncedCount,
        completedAt: new Date(),
      });

      this.logger.log(
        `[companyId=${companyId}] Sync de historial de compras completado (${syncedCount} facturas en los últimos ${SYNC_HISTORY_YEARS} años, ${totalPages} página(s)).`,
      );
    } catch (error) {
      this.logger.error(
        `[companyId=${companyId}] Error en sync de historial de compras`,
        error instanceof Error ? error.stack : String(error),
      );

      await this.updateJob(jobId, {
        status: SiigoPurchaseSyncJobStatus.ERROR,
        errorMessage: this.resolveSyncErrorMessage(error),
        completedAt: new Date(),
      });
    }
  }

  /** Distingue una caída transitoria de SIIGO (503/document_query_service,
   * ya reintentada un par de veces en executeSiigoRequestWithRetries antes
   * de llegar hasta acá) de un error nuestro — para que el mensaje que ve
   * el usuario en el estado del sync diga claramente que el problema es de
   * SIIGO y no algo que rompimos. */
  private resolveSyncErrorMessage(error: unknown): string {
    if (isSiigoServiceUnavailableApiError(error)) {
      return 'SIIGO no está disponible en este momento (su servicio de consulta de documentos está caído). Ya reintentamos automáticamente; por favor vuelve a sincronizar en unos minutos.';
    }

    return error instanceof Error
      ? error.message
      : 'Error inesperado en el sync.';
  }

  private fetchPage(
    companyId: string,
    page: number,
  ): Promise<SiigoPurchasesListResponse> {
    return executeSiigoRequestWithRetries(
      this.siigoAuthService,
      companyId,
      this.logger,
      'listar facturas de compra',
      (accessToken, partnerId) =>
        this.siigoHttpClient.listPurchases(
          accessToken,
          page,
          SYNC_PAGE_SIZE,
          partnerId,
        ),
    );
  }

  /**
   * Borra e inserta en lote para TODAS las facturas de la página en una sola
   * query de cada tipo, en vez de una por factura — con miles de facturas,
   * hacer 2 queries por factura era el cuello de botella real del sync.
   */
  private async persistPageBatch(
    companyId: string,
    integrationId: string,
    purchases: SiigoPurchaseResponse[],
    cutoffDate: string,
    taxCatalogById: ReturnType<typeof buildTaxCatalogById>,
  ): Promise<number> {
    const relevantPurchases = purchases.filter(
      (purchase) => purchase.date >= cutoffDate && purchase.items?.length,
    );

    if (relevantPurchases.length === 0) {
      return 0;
    }

    const rows: HistorialFactura[] = [];
    const facturaIds: string[] = [];

    for (const purchase of relevantPurchases) {
      const proveedorNit = normalizeSupplierDocument(
        purchase.supplier.identification ?? '',
      );

      if (!proveedorNit) {
        continue;
      }

      facturaIds.push(purchase.id);

      const payment = purchase.payments?.[0];
      const providerInvoicePrefix =
        purchase.provider_invoice?.prefix?.trim() || null;
      const providerInvoiceNumber =
        purchase.provider_invoice?.number?.trim() || null;

      for (const item of purchase.items ?? []) {
        rows.push(
          this.historialFacturasRepository.create({
            companyId,
            integrationId,
            facturaId: purchase.id,
            proveedorNit,
            descripcionItem: item.description?.trim() || 'Ítem sin descripción',
            tipo: mapSiigoItemTypeToHistorialTipo(item.type),
            cuentaPuc: item.code,
            impuestos: classifySiigoPurchaseTaxes(
              item.taxes,
              purchase.retentions,
              taxCatalogById,
            ),
            metodoPagoId: payment?.id ?? null,
            metodoPagoNombre: payment?.name?.trim() || null,
            providerInvoicePrefix,
            providerInvoiceNumber,
            siigoNumero: Number.isFinite(purchase.number) ? purchase.number : null,
            fuente: HistorialFacturaFuente.SIIGO_ORIGINAL,
            fechaFactura: purchase.date,
          }),
        );
      }
    }

    if (facturaIds.length === 0) {
      return 0;
    }

    await this.historialFacturasRepository.replaceRowsForFacturas(
      companyId,
      integrationId,
      facturaIds,
      rows,
      HistorialFacturaFuente.SIIGO_ORIGINAL,
    );

    return facturaIds.length;
  }

  /**
   * Recalcula la variabilidad de cada proveedor CAMPO POR CAMPO (cuenta
   * contable, tipo de ítem, medio de pago, y cada categoría de impuesto),
   * en vez de un único booleano a nivel de proveedor completo basado solo
   * en la cuenta — dos facturas del mismo proveedor pueden diferir en medio
   * de pago pero coincidir siempre en cuenta contable, y con el modelo
   * viejo eso apagaba TODAS las sugerencias (incluida la de cuenta, que sí
   * era confiable). Ver SupplierFieldVariability para la forma exacta.
   */
  private async recomputeSupplierSummaries(
    companyId: string,
    integrationId: string,
  ): Promise<void> {
    const [
      cuentaGroups,
      tipoGroups,
      medioPagoGroups,
      paymentTypesCatalog,
      impuestoGroupsByCampo,
    ] = await Promise.all([
      this.historialFacturasRepository.groupByProveedorAndCuenta(
        companyId,
        integrationId,
      ),
      this.historialFacturasRepository.groupByProveedorAndTipo(
        companyId,
        integrationId,
      ),
      this.historialFacturasRepository.groupByProveedorAndMetodoPago(
        companyId,
        integrationId,
      ),
      // Mismo catálogo ('FC', el que usa Factura de compra al enviar) que
      // antes usaba buildBestPaymentMethodMap.
      this.siigoPaymentTypesCatalogService.listPaymentTypes(
        { documentType: 'FC' },
        companyId,
      ),
      Promise.all(
        IMPUESTO_CAMPOS.map((campo) =>
          this.historialFacturasRepository
            .groupByProveedorAndImpuestoCampo(companyId, integrationId, campo)
            .then(
              (groups) =>
                [campo, groups] as [
                  string,
                  HistorialFacturaImpuestoCampoGroup[],
                ],
            ),
        ),
      ).then((entries) => new Map(entries)),
    ]);

    const cuenta = pickDominantGroups(cuentaGroups);
    const tipo = pickDominantGroups(tipoGroups);
    const medioPago = pickDominantGroups(medioPagoGroups);
    const paymentTypeById = new Map(
      paymentTypesCatalog.map((paymentType) => [paymentType.id, paymentType]),
    );
    const impuestosPorCampo = new Map(
      IMPUESTO_CAMPOS.map((campo) => [
        campo,
        pickDominantGroups(impuestoGroupsByCampo.get(campo) ?? []),
      ]),
    );

    // Se trae UNA vez el catálogo completo de preferencias en vez de una
    // consulta por proveedor (antes eran N consultas repitiendo el mismo
    // SELECT completo de la tabla, una por proveedor distinto).
    const existingConfigurations =
      await this.supplierConfigurationsRepository.findByCompanyAndIntegration(
        companyId,
        integrationId,
      );
    const configurationByNit = new Map<string, SupplierConfiguration>(
      existingConfigurations.map((configuration) => [
        normalizeSupplierDocument(configuration.supplierDocument),
        configuration,
      ]),
    );

    const configurationsToSave: SupplierConfiguration[] = [];

    // Todo proveedor con historial aparece acá (cuenta_puc nunca es null en
    // historial_facturas), así que es un universo completo — no hace falta
    // unir con los demás agrupamientos.
    for (const proveedorNit of cuenta.totalsByProveedor.keys()) {
      const cuentaBest = cuenta.bestByProveedor.get(proveedorNit) ?? null;
      const cuentaTotal = cuenta.totalsByProveedor.get(proveedorNit) ?? 0;
      const cuentaFixed = cuentaBest
        ? isFieldFixed(cuentaBest.count, cuentaTotal)
        : false;

      let configuration = configurationByNit.get(proveedorNit);

      if (!configuration) {
        configuration = this.supplierConfigurationsRepository.create({
          companyId,
          integrationId,
          supplierDocument: proveedorNit,
          supplierDocumentType: 'NIT',
          supplierName: null,
          itemType: SIIGO_DEFAULT_ITEM_TYPE,
        });
      }

      // Señal general de estabilidad de la CUENTA únicamente — se conserva
      // igual que antes (otros consumidores puntuales, ej.
      // SiigoPurchaseAiClassificationService, siguen leyendo este campo),
      // pero ya no es el gate de las sugerencias: ver campoVariabilidad.
      configuration.tieneVariabilidad = cuentaTotal > 0 ? !cuentaFixed : null;
      configuration.ultimaActualizacion = new Date();

      const campoVariabilidad: SupplierFieldVariability = {};

      if (cuentaBest) {
        campoVariabilidad.cuentaPuc = cuentaFixed
          ? { variable: false, valor: cuentaBest.cuentaPuc }
          : { variable: true, valor: null };
      }

      const tipoBest = tipo.bestByProveedor.get(proveedorNit) ?? null;
      const tipoTotal = tipo.totalsByProveedor.get(proveedorNit) ?? 0;

      if (tipoBest) {
        const tipoFixed = isFieldFixed(tipoBest.count, tipoTotal);
        // 'Account'/'Product' (no la forma abreviada 'cuenta'/'producto' de
        // HistorialFacturaTipo) — así el front lo consume directo como
        // items[].type de SIIGO sin necesitar otra tabla de mapeo.
        const tipoValue: 'Account' | 'Product' =
          tipoBest.tipo === HistorialFacturaTipo.PRODUCTO
            ? 'Product'
            : 'Account';

        campoVariabilidad.tipoItem = tipoFixed
          ? { variable: false, valor: tipoValue }
          : { variable: true, valor: null };
        // itemType (columna dedicada, la usan otros flujos aparte de la
        // sugerencia) se actualiza con el tipo dominante — votado sobre
        // TODO el historial del proveedor, no solo el de la cuenta
        // dominante como antes.
        configuration.itemType = tipoValue;
      }

      const medioPagoBest = medioPago.bestByProveedor.get(proveedorNit) ?? null;
      const medioPagoTotal = medioPago.totalsByProveedor.get(proveedorNit) ?? 0;

      if (medioPagoBest) {
        const medioPagoFixed = isFieldFixed(
          medioPagoBest.count,
          medioPagoTotal,
        );
        const catalogMatch = medioPagoFixed
          ? paymentTypeById.get(medioPagoBest.metodoPagoId)
          : undefined;

        // Si el id ya no existe en el catálogo (medio de pago borrado/
        // editado en SIIGO desde entonces), se trata como variable en vez
        // de sugerir un id que SIIGO podría rechazar al enviar.
        campoVariabilidad.medioPago = catalogMatch
          ? {
              variable: false,
              valor: {
                id: catalogMatch.id,
                name: catalogMatch.name,
                type: catalogMatch.type,
                dueDate: catalogMatch.dueDate,
              },
            }
          : { variable: true, valor: null };
      }

      for (const campo of IMPUESTO_CAMPOS) {
        campoVariabilidad[campo] = await this.resolveImpuestoCampoEntry(
          companyId,
          integrationId,
          proveedorNit,
          campo,
          impuestosPorCampo.get(campo)!,
        );
      }

      configuration.campoVariabilidad = campoVariabilidad;

      // preference (snapshot legacy que usa el flujo de envío manual): se
      // actualiza cuando la cuenta es fija, igual que antes, preservando
      // paymentMethod/costCenter que el contador haya guardado a mano —
      // pero ahora las retenciones que entran acá sí reflejan la
      // variabilidad independiente de cada categoría de impuesto, no solo
      // "lo que traía la factura más reciente de la cuenta dominante".
      if (cuentaFixed && cuentaBest) {
        configuration.preference = {
          account: { code: cuentaBest.cuentaPuc, name: cuentaBest.cuentaPuc },
          retentions: mapImpuestosToRetentionPreferences({
            retefuente: campoVariabilidad.retefuente?.valor ?? undefined,
            reteica: campoVariabilidad.reteica?.valor ?? undefined,
            autorretencion:
              campoVariabilidad.autorretencion?.valor ?? undefined,
          }),
          ...(configuration.preference?.paymentMethod !== undefined
            ? { paymentMethod: configuration.preference.paymentMethod }
            : {}),
          ...(configuration.preference?.costCenter !== undefined
            ? { costCenter: configuration.preference.costCenter }
            : {}),
        };
      }

      configurationsToSave.push(configuration);
    }

    if (configurationsToSave.length > 0) {
      await this.supplierConfigurationsRepository.saveMany(
        configurationsToSave,
      );
    }
  }

  /** Variabilidad + valor fijo (si aplica) de UNA categoría de impuesto para
   * un proveedor — `taxId: null` ganador (la categoría consistentemente no
   * aplica) es un resultado fijo válido, no se consulta nada más para él.
   * `undefined` significa que esa categoría nunca apareció en el historial
   * de este proveedor (ni siquiera como "ausente"). */
  private async resolveImpuestoCampoEntry(
    companyId: string,
    integrationId: string,
    proveedorNit: string,
    campo: HistorialFacturaImpuestoCampo,
    grouped: DominantGroupsResult<HistorialFacturaImpuestoCampoGroup>,
  ): Promise<
    { variable: boolean; valor: HistorialFacturaTaxDetail | null } | undefined
  > {
    const best = grouped.bestByProveedor.get(proveedorNit);
    const total = grouped.totalsByProveedor.get(proveedorNit) ?? 0;

    if (!best) {
      return undefined;
    }

    if (!isFieldFixed(best.count, total)) {
      return { variable: true, valor: null };
    }

    const valor =
      await this.historialFacturasRepository.findMostRecentByProveedorAndImpuestoCampo(
        companyId,
        integrationId,
        proveedorNit,
        campo,
        best.taxId,
      );

    return { variable: false, valor };
  }

  private buildCutoffDate(): string {
    const cutoff = new Date();
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - SYNC_HISTORY_YEARS);

    return cutoff.toISOString().slice(0, 10);
  }

  private async updateJob(
    jobId: string,
    patch: Partial<
      Pick<
        SiigoPurchaseSyncJob,
        'status' | 'syncedCount' | 'totalCount' | 'errorMessage' | 'completedAt'
      >
    >,
  ): Promise<void> {
    const job = await this.siigoPurchaseSyncJobsRepository.findById(jobId);

    if (!job) {
      return;
    }

    Object.assign(job, patch);
    await this.siigoPurchaseSyncJobsRepository.save(job);
  }
}
