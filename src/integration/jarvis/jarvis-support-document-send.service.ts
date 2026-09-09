import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { withPostgresAdvisoryLock } from '../../common/helpers/postgres-advisory-lock.helper';
import { CompaniesRepository } from '../../company/repositories/companies.repository';
import { ElectronicDocumentStatus } from '../../electronic-document/enums/electronic-document-status.enum';
import { ElectronicDocumentType } from '../../electronic-document/enums/electronic-document-type.enum';
import { ElectronicDocumentService } from '../../electronic-document/electronic-document.service';
import { mapElectronicDocumentToResponse } from '../../electronic-document/mappers/electronic-document-response.mapper';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { PlanSubscriptionService } from '../../plan/plan-subscription.service';
import { JarvisDocumentType } from './enums/jarvis-document-type.enum';
import { JarvisEntityType } from './enums/jarvis-entity-type.enum';
import { JarvisTaxRegime } from './enums/jarvis-tax-regime.enum';
import { JarvisTaxResponsibility } from './enums/jarvis-tax-responsibility.enum';
import { JarvisVatRegime } from './enums/jarvis-vat-regime.enum';
import { normalizeJarvisCredentials } from './helpers/jarvis-credentials.helper';
import {
  normalizeJarvisDocumentNumber,
  normalizeJarvisDocumentType,
} from './helpers/jarvis-document-number.helper';
import { JarvisTercerosRepository } from './repositories/jarvis-terceros.repository';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import {
  CreateJarvisSupportDocumentRequestDto,
  CreateJarvisSupportDocumentResponseDto,
  CreateManualJarvisSupportDocumentRequestDto,
  CreateManualJarvisSupportDocumentResponseDto,
  JarvisCatalogsResponseDto,
} from './dto/create-jarvis-support-document.dto';
import { NextPymeApiClient } from './nextpyme/nextpyme-api.client';
import { NextPymeMasterCatalogService } from './nextpyme/nextpyme-master-catalog.service';
import { JarvisResolutionKind } from './enums/jarvis-resolution-kind.enum';
import { JarvisSetupService } from './jarvis-setup.service';
import {
  daysBetweenLocalDates,
  formatMoney,
  readNextPymeCreatedConsecutive,
  readNextPymeCreatedId,
  readNextPymeCreatedNumber,
  readNextPymeCreatedUniqueCode,
  toMoney,
} from './helpers/jarvis-nextpyme-response.helper';
import type {
  GroupedSupportDocument,
  SupportDocumentExcelRow,
} from '../../electronic-document/interfaces/support-document-import.interface';

const DOCUMENT_TYPE_IDENTIFICATION_FALLBACK: Record<string, number> = {
  [JarvisDocumentType.CC]: 3,
  [JarvisDocumentType.CE]: 5,
  [JarvisDocumentType.NIT]: 6,
  [JarvisDocumentType.PA]: 7,
};

@Injectable()
export class JarvisSupportDocumentSendService {
  private readonly logger = new Logger(JarvisSupportDocumentSendService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly electronicDocumentService: ElectronicDocumentService,
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly jarvisTercerosRepository: JarvisTercerosRepository,
    private readonly companiesRepository: CompaniesRepository,
    private readonly planSubscriptionService: PlanSubscriptionService,
    private readonly nextPymeApiClient: NextPymeApiClient,
    private readonly nextPymeMasterCatalogService: NextPymeMasterCatalogService,
    private readonly jarvisSetupService: JarvisSetupService,
  ) {}

  async listCatalogs(): Promise<JarvisCatalogsResponseDto> {
    const [taxes, paymentMethods, paymentForms, currencies] = await Promise.all(
      [
        this.nextPymeMasterCatalogService.getTaxes(),
        this.nextPymeMasterCatalogService.getPaymentMethods(),
        this.nextPymeMasterCatalogService.getPaymentForms(),
        this.nextPymeMasterCatalogService.getTypeCurrencies(),
      ],
    );

    return {
      taxes: taxes.map((tax) => ({
        id: tax.id,
        name: tax.name,
        code: tax.code ?? null,
        type: tax.name,
        percentage: null,
      })),
      paymentMethods: paymentMethods.map((method) => ({
        id: method.id,
        name: method.name,
        code: method.code ?? null,
        type: 'NextPyme',
      })),
      paymentForms: paymentForms.map((form) => ({
        id: form.id,
        name: form.name,
        code: form.code ?? null,
      })),
      currencies: currencies.map((currency) => ({
        id: currency.id,
        name: currency.name,
        code: currency.code ?? null,
      })),
    };
  }

  async createManualSupportDocument(
    request: CreateManualJarvisSupportDocumentRequestDto,
    companyId: string,
  ): Promise<CreateManualJarvisSupportDocumentResponseDto> {
    const issueDate = request.issueDate?.trim();
    const supplierIdentification = normalizeJarvisDocumentNumber(
      request.supplierIdentification ?? '',
    );
    const documentPrefix = request.documentPrefix?.trim() || 'DS';
    const documentNumber = request.documentNumber?.trim();
    const currency = (request.currency?.trim() || 'COP').toUpperCase();
    const items = Array.isArray(request.items) ? request.items : [];

    if (!issueDate) {
      throw new BadRequestException('La fecha de elaboración es obligatoria.');
    }

    if (!supplierIdentification) {
      throw new BadRequestException(
        'Debe seleccionar un proveedor (NIT o documento).',
      );
    }

    if (!documentNumber) {
      throw new BadRequestException(
        'El consecutivo del comprobante del proveedor es obligatorio.',
      );
    }

    if (items.length === 0) {
      throw new BadRequestException(
        'Debe agregar al menos un producto o servicio.',
      );
    }

    const documentType = normalizeJarvisDocumentType(
      request.supplierDocumentType,
    );
    const tercero =
      await this.jarvisTercerosRepository.findByCompanyAndDocument(
        companyId,
        documentType,
        supplierIdentification,
      );

    if (!tercero && request.send) {
      throw new BadRequestException(
        'Debe crear el tercero (proveedor) en Jarvis antes de enviar el documento soporte.',
      );
    }

    const supplierName =
      request.supplierName?.trim() ||
      tercero?.name?.trim() ||
      supplierIdentification;

    const rows: SupportDocumentExcelRow[] = items.map((item, index) => {
      const description = item.description?.trim();
      if (!description) {
        throw new BadRequestException(
          `La descripción del ítem ${index + 1} es obligatoria.`,
        );
      }

      const quantity = Number(item.quantity);
      const unitValue = Number(item.unitValue);
      const discount = Math.max(0, Number(item.discount ?? 0));
      const taxAmount = Math.max(0, Number(item.taxAmount ?? 0));

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException(
          `La cantidad del ítem ${index + 1} debe ser mayor a 0.`,
        );
      }

      if (!Number.isFinite(unitValue) || unitValue < 0) {
        throw new BadRequestException(
          `El valor unitario del ítem ${index + 1} no es válido.`,
        );
      }

      const lineTotal = toMoney(quantity * unitValue - discount);
      const itemCode = item.code?.trim();

      return {
        supplierIdentification,
        supplierDocumentType: documentType,
        supplierName,
        documentPrefix,
        documentNumber,
        issueDate,
        ...(request.payment?.due_date?.trim()
          ? { dueDate: request.payment.due_date.trim() }
          : {}),
        currency,
        itemDescription: description,
        ...(itemCode ? { itemCode } : {}),
        quantity,
        unitValue: toMoney(unitValue),
        lineTotal,
        taxAmount: toMoney(taxAmount),
        ...(request.observations?.trim()
          ? { observations: request.observations.trim() }
          : {}),
      };
    });

    const group: GroupedSupportDocument = {
      groupKey: `${supplierIdentification}|${documentPrefix}|${documentNumber}|${issueDate}`,
      supplierIdentification,
      supplierDocumentType: documentType,
      supplierName,
      documentPrefix,
      documentNumber,
      issueDate,
      ...(request.payment?.due_date?.trim()
        ? { dueDate: request.payment.due_date.trim() }
        : {}),
      currency,
      ...(request.observations?.trim()
        ? { observations: request.observations.trim() }
        : {}),
      rows,
    };

    const created =
      await this.electronicDocumentService.createFromSupportDocumentGroups(
        [group],
        companyId,
      );
    const documentId = created.documentIds[0];

    if (!documentId) {
      throw new BadRequestException(
        'No se pudo crear el Documento Soporte individual.',
      );
    }

    if (!request.send) {
      const document = await this.electronicDocumentService.requireById(
        documentId,
        companyId,
      );

      return {
        documentId,
        sent: false,
        document: mapElectronicDocumentToResponse(document),
      };
    }

    const sendResult = await this.sendSupportDocument(
      {
        documentId,
        date: issueDate,
        ...(request.observations?.trim()
          ? { observations: request.observations.trim() }
          : {}),
        ...(request.retentions?.length
          ? { retentions: request.retentions }
          : {}),
        ...(request.payment ? { payment: request.payment } : {}),
      },
      companyId,
    );

    return {
      documentId,
      sent: true,
      document: sendResult.document,
      supportDocument: sendResult.supportDocument,
    };
  }

  async sendSupportDocument(
    request: CreateJarvisSupportDocumentRequestDto,
    companyId: string,
  ): Promise<CreateJarvisSupportDocumentResponseDto> {
    await this.planSubscriptionService.assertCanCreateDocuments({
      companyId,
      provider: IntegrationProvider.JARVIS,
      documentType: ElectronicDocumentType.SUPPORT_DOCUMENT,
      quantity: 1,
    });

    const documentId = request.documentId?.trim();
    if (!documentId) {
      throw new BadRequestException('El campo documentId es obligatorio.');
    }

    const electronicDocument = await this.electronicDocumentService.requireById(
      documentId,
      companyId,
    );

    if (
      electronicDocument.electronicDocumentType !==
      ElectronicDocumentType.SUPPORT_DOCUMENT
    ) {
      throw new BadRequestException(
        'El documento indicado no es un Documento Soporte.',
      );
    }

    if (
      electronicDocument.status === ElectronicDocumentStatus.PURCHASE_CREATED
    ) {
      throw new BadRequestException(
        'El Documento Soporte ya fue enviado a DIAN para este registro.',
      );
    }

    const integration =
      await this.integrationsRepository.findByCompanyAndProvider(
        companyId,
        IntegrationProvider.JARVIS,
      );

    if (!integration) {
      throw new NotFoundException(
        'La empresa activa no tiene integración Jarvis configurada.',
      );
    }

    const supplierDocumentNumber = normalizeJarvisDocumentNumber(
      electronicDocument.payload.supplier.documentNumber ||
        electronicDocument.documentNumberThird ||
        '',
    );

    if (!supplierDocumentNumber) {
      throw new BadRequestException(
        'El documento no tiene NIT/documento de proveedor válido.',
      );
    }

    const documentType = normalizeJarvisDocumentType(
      electronicDocument.payload.supplier.documentType ||
        electronicDocument.documentTypeThird,
    );

    const tercero =
      await this.jarvisTercerosRepository.findByCompanyAndDocument(
        companyId,
        documentType,
        supplierDocumentNumber,
      );

    if (!tercero) {
      throw new BadRequestException(
        'Debe crear el tercero (proveedor) en Jarvis antes de enviar el documento soporte.',
      );
    }

    const company = await this.companiesRepository.findById(companyId);
    const credentials = normalizeJarvisCredentials(integration.credentials);
    const issueDate =
      request.date?.trim() ||
      electronicDocument.payload.invoice.issueDate ||
      new Date().toISOString().slice(0, 10);

    const resolutionLockKey = `jarvis-resolution:${companyId}:${JarvisResolutionKind.SUPPORT_DOCUMENT}`;

    try {
      return await withPostgresAdvisoryLock(
        this.dataSource,
        resolutionLockKey,
        async () => {
          // Relee el estado DENTRO del lock (no el `electronicDocument` de
          // arriba, ya viejo) — si otro intento concurrente para ESTE mismo
          // documento ganó la carrera mientras esperábamos el lock (ej.
          // doble clic en "Enviar"), aborta acá en vez de numerar y enviar
          // un segundo documento duplicado a NextPyme.
          const freshDocument =
            await this.electronicDocumentService.requireById(
              documentId,
              companyId,
            );

          if (
            freshDocument.status === ElectronicDocumentStatus.PURCHASE_CREATED
          ) {
            throw new BadRequestException(
              'El Documento Soporte ya fue creado para este registro.',
            );
          }

          const numbering =
            await this.jarvisSetupService.allocateResolutionNumber(
              companyId,
              JarvisResolutionKind.SUPPORT_DOCUMENT,
            );
          const municipalityId =
            await this.nextPymeMasterCatalogService.resolveMunicipalityId(
              credentials.municipality,
              credentials.city ?? company?.name,
              electronicDocument.payload.supplier.cityCode,
            );
          const liabilityId =
            await this.nextPymeMasterCatalogService.resolveLiabilityId(
              credentials.tax_responsibility ??
                JarvisTaxResponsibility.NOT_APPLICABLE,
            );
          const terceroVatRegime =
            tercero.taxRegime === JarvisTaxRegime.SIMPLIFIED
              ? JarvisVatRegime.NON_RESPONSIBLE
              : tercero.taxRegime
                ? JarvisVatRegime.RESPONSIBLE
                : credentials.vat_regime;
          const regimeId =
            await this.nextPymeMasterCatalogService.resolveRegimeId(
              terceroVatRegime ?? JarvisVatRegime.RESPONSIBLE,
            );

          this.logger.log(
            `[documentId=${documentId}] Numeración local ${JSON.stringify({
              resolutionNumber: numbering.formNumber,
              prefix: numbering.prefix,
              number: numbering.number,
              toNumber: numbering.toNumber,
              municipalityId,
              liabilityId,
              regimeId,
              terceroVatRegime,
              typeDocumentIdentificationId:
                DOCUMENT_TYPE_IDENTIFICATION_FALLBACK[documentType] ?? 6,
            })}`,
          );

          const totals = this.buildMonetaryTotals(electronicDocument.payload);
          const taxTotals = this.buildTaxTotals(
            electronicDocument.payload,
            request.retentions ?? [],
          );
          const invoiceLines = this.buildInvoiceLines(
            electronicDocument.payload,
            issueDate,
            taxTotals,
          );
          const currencyId =
            await this.nextPymeMasterCatalogService.resolveCurrencyId(
              electronicDocument.payload.invoice.currency,
            );

          const payload = {
            type_document_id:
              this.nextPymeMasterCatalogService.getSupportDocumentTypeId(),
            number: numbering.number,
            date: issueDate,
            prefix: numbering.prefix,
            ...(currencyId ? { type_currency_id: currencyId } : {}),
            ...(request.observations?.trim() ||
            electronicDocument.payload.observations?.trim()
              ? {
                  notes:
                    request.observations?.trim() ||
                    electronicDocument.payload.observations?.trim(),
                }
              : {}),
            seller: {
              identification_number: Number(tercero.documentNumber),
              ...(tercero.checkDigit
                ? { dv: Number(tercero.checkDigit) || tercero.checkDigit }
                : {}),
              name: tercero.name,
              phone: tercero.phone || credentials.phone || '0000000000',
              address:
                tercero.address || credentials.address || 'SIN DIRECCION',
              email:
                tercero.email || credentials.email || 'sin-email@example.com',
              type_document_identification_id:
                DOCUMENT_TYPE_IDENTIFICATION_FALLBACK[documentType] ?? 6,
              type_organization_id:
                tercero.entityType === JarvisEntityType.NATURAL_PERSON ? 2 : 1,
              municipality_id: municipalityId,
              type_liability_id: liabilityId,
              type_regime_id: regimeId,
            },
            ...(request.payment?.id
              ? {
                  payment_form: {
                    payment_form_id: request.payment.payment_form_id ?? 1,
                    payment_method_id: request.payment.id,
                    payment_due_date: request.payment.due_date || issueDate,
                    duration_measure: String(
                      daysBetweenLocalDates(
                        issueDate,
                        request.payment.due_date || issueDate,
                      ),
                    ),
                  },
                }
              : {}),
            legal_monetary_totals: totals,
            ...(taxTotals.length > 0 ? { tax_totals: taxTotals } : {}),
            invoice_lines: invoiceLines,
          };

          this.logger.log(
            `[documentId=${documentId}] Body documento soporte -> NextPyme ${JSON.stringify(
              payload,
              null,
              2,
            )}`,
          );

          const created =
            await this.nextPymeApiClient.createSupportDocument(payload);

          this.logger.log(
            `[documentId=${documentId}] Respuesta NextPyme ${JSON.stringify(created)}`,
          );
          const createdId = readNextPymeCreatedId(
            created,
            numbering.prefix,
            numbering.number,
          );
          const createdConsecutive = readNextPymeCreatedConsecutive(
            created,
            numbering.prefix,
            numbering.number,
          );
          const createdNumber = readNextPymeCreatedNumber(
            created,
            numbering.number,
            createdConsecutive,
          );
          const createdCude = readNextPymeCreatedUniqueCode(created);

          await this.jarvisSetupService.commitResolutionNumber(
            companyId,
            JarvisResolutionKind.SUPPORT_DOCUMENT,
            createdNumber,
          );

          const updatedDocument =
            await this.electronicDocumentService.markPurchaseCreated(
              documentId,
              createdId,
              companyId,
              createdConsecutive,
              {
                ...electronicDocument.payload,
                observations:
                  request.observations?.trim() ||
                  electronicDocument.payload.observations,
              },
            );

          this.logger.log(
            `[documentId=${documentId}] Documento soporte enviado a NextPyme (id=${createdId}, consecutive=${createdConsecutive}, number=${createdNumber}, cude=${createdCude ?? 'n/a'})`,
          );

          return {
            success: true,
            supportDocument: {
              id: createdId,
              number: createdNumber,
              consecutive: createdConsecutive,
              prefix: numbering.prefix,
              date: issueDate,
              cude: createdCude,
            },
            document: mapElectronicDocumentToResponse(updatedDocument),
          };
        },
      );
    } catch (error) {
      await this.electronicDocumentService.updateStatus(
        documentId,
        ElectronicDocumentStatus.PURCHASE_FAILED,
        companyId,
      );

      this.logger.error(
        `[documentId=${documentId}] Error al enviar Documento Soporte a NextPyme`,
        error instanceof Error ? error.stack : String(error),
      );

      if (
        error instanceof BadRequestException ||
        error instanceof BadGatewayException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      throw new BadGatewayException(
        error instanceof Error
          ? error.message
          : 'Error inesperado al crear el Documento Soporte.',
      );
    }
  }

  private buildMonetaryTotals(
    payload: Awaited<
      ReturnType<ElectronicDocumentService['requireById']>
    >['payload'],
  ) {
    const lineExtension = toMoney(payload.totals.subtotal);
    const taxAmount = toMoney(payload.totals.iva);
    const payable = toMoney(
      payload.totals.total || lineExtension + taxAmount,
    );

    return {
      line_extension_amount: formatMoney(lineExtension),
      tax_exclusive_amount: formatMoney(lineExtension),
      tax_inclusive_amount: formatMoney(payable),
      payable_amount: formatMoney(payable),
      allowance_total_amount: '0.00',
      charge_total_amount: '0.00',
      pre_paid_amount: '0.00',
    };
  }

  private buildTaxTotals(
    payload: Awaited<
      ReturnType<ElectronicDocumentService['requireById']>
    >['payload'],
    retentions: CreateJarvisSupportDocumentRequestDto['retentions'],
  ) {
    const totals: Array<{
      tax_id: number;
      tax_amount: string;
      taxable_amount: string;
      percent: string;
    }> = [];

    const taxable = toMoney(payload.totals.subtotal);
    const ivaAmount = toMoney(payload.totals.iva);

    if (ivaAmount > 0 && taxable > 0) {
      const percent = (ivaAmount / taxable) * 100;
      totals.push({
        tax_id: this.nextPymeMasterCatalogService.getIvaTaxId(),
        tax_amount: formatMoney(ivaAmount),
        taxable_amount: formatMoney(taxable),
        percent: formatMoney(percent),
      });
    }

    for (const retention of retentions ?? []) {
      if (!retention?.id || !Number.isFinite(retention.id)) {
        continue;
      }

      const percentage = Number(retention.percentage ?? 0);
      const taxAmount =
        percentage > 0 ? toMoney((taxable * percentage) / 100) : 0;

      totals.push({
        tax_id: retention.id,
        tax_amount: formatMoney(taxAmount),
        taxable_amount: formatMoney(taxable),
        percent: formatMoney(percentage),
      });
    }

    return totals;
  }

  private buildInvoiceLines(
    payload: Awaited<
      ReturnType<ElectronicDocumentService['requireById']>
    >['payload'],
    issueDate: string,
    taxTotals: Array<{
      tax_id: number;
      tax_amount: string;
      taxable_amount: string;
      percent: string;
    }>,
  ) {
    const sourceItems =
      payload.items?.length > 0
        ? payload.items
        : [
            {
              descripcion: 'Documento soporte',
              cantidad: 1,
              valorUnitario: payload.totals.subtotal,
              total: payload.totals.subtotal,
            },
          ];

    const ivaTax = taxTotals.find(
      (tax) => tax.tax_id === this.nextPymeMasterCatalogService.getIvaTaxId(),
    );

    return sourceItems.map((item, index) => {
      const quantity = item.cantidad > 0 ? item.cantidad : 1;
      const lineExtension = toMoney(
        item.total > 0 ? item.total : quantity * item.valorUnitario,
      );
      const unitValue = toMoney(
        item.valorUnitario > 0 ? item.valorUnitario : lineExtension / quantity,
      );

      return {
        unit_measure_id:
          this.nextPymeMasterCatalogService.getDefaultUnitMeasureId(),
        invoiced_quantity: quantity,
        line_extension_amount: lineExtension,
        free_of_charge_indicator: false,
        description: item.descripcion?.trim() || `Ítem ${index + 1}`,
        code: item.codigo?.trim() || `ITEM-${index + 1}`,
        type_item_identification_id:
          this.nextPymeMasterCatalogService.getDefaultItemIdentificationId(),
        price_amount: unitValue,
        base_quantity: quantity,
        type_generation_transmition_id:
          this.nextPymeMasterCatalogService.getDefaultGenerationTransmissionId(),
        start_date: issueDate,
        ...(ivaTax
          ? {
              tax_totals: [
                {
                  tax_id: ivaTax.tax_id,
                  tax_amount: ivaTax.tax_amount,
                  taxable_amount: formatMoney(lineExtension),
                  percent: ivaTax.percent,
                },
              ],
            }
          : {}),
      };
    });
  }

}
