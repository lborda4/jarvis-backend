import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { extractNextPymeInvoiceXml } from './nextpyme/nextpyme-invoice-xml.helper';
import { withPostgresAdvisoryLock } from '../../common/helpers/postgres-advisory-lock.helper';
import { CompaniesRepository } from '../../company/repositories/companies.repository';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { JarvisDocumentType } from './enums/jarvis-document-type.enum';
import { JarvisEntityType } from './enums/jarvis-entity-type.enum';
import { JarvisResolutionKind } from './enums/jarvis-resolution-kind.enum';
import { JarvisTaxRegime } from './enums/jarvis-tax-regime.enum';
import { JarvisTaxResponsibility } from './enums/jarvis-tax-responsibility.enum';
import { JarvisVatRegime } from './enums/jarvis-vat-regime.enum';
import { normalizeJarvisCredentials } from './helpers/jarvis-credentials.helper';
import {
  normalizeJarvisDocumentNumber,
  normalizeJarvisDocumentType,
} from './helpers/jarvis-document-number.helper';
import {
  daysBetweenLocalDates,
  formatMoney,
  readNextPymeCreatedConsecutive,
  readNextPymeCreatedId,
  readNextPymeCreatedNumber,
  readNextPymeCreatedUniqueCode,
  toMoney,
} from './helpers/jarvis-nextpyme-response.helper';
import { JarvisTercerosRepository } from './repositories/jarvis-terceros.repository';
import {
  CreateJarvisInvoiceRequestDto,
  CreateJarvisInvoiceResponseDto,
} from './dto/create-jarvis-invoice.dto';
import { JarvisInvoiceHistoryService } from './jarvis-invoice-history.service';
import { JarvisSetupService } from './jarvis-setup.service';
import { NextPymeApiClient } from './nextpyme/nextpyme-api.client';
import { NextPymeMasterCatalogService } from './nextpyme/nextpyme-master-catalog.service';

import { buildJarvisInvoiceChargeTaxTotals } from './helpers/jarvis-invoice-tax.helper';
import { calculateJarvisRetention } from './helpers/jarvis-tax-calculation.helper';

const DOCUMENT_TYPE_IDENTIFICATION_FALLBACK: Record<string, number> = {
  [JarvisDocumentType.CC]: 3,
  [JarvisDocumentType.CE]: 5,
  [JarvisDocumentType.NIT]: 6,
  [JarvisDocumentType.PA]: 7,
};

/** Emite facturas de venta y registra los envios aceptados en el historial de la empresa. */
@Injectable()
export class JarvisInvoiceSendService {
  private readonly logger = new Logger(JarvisInvoiceSendService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly jarvisTercerosRepository: JarvisTercerosRepository,
    private readonly companiesRepository: CompaniesRepository,
    private readonly nextPymeApiClient: NextPymeApiClient,
    private readonly nextPymeMasterCatalogService: NextPymeMasterCatalogService,
    private readonly jarvisSetupService: JarvisSetupService,
    private readonly invoiceHistory: JarvisInvoiceHistoryService,
  ) {}

  async createAndSendInvoice(
    request: CreateJarvisInvoiceRequestDto,
    companyId: string,
    kind = JarvisResolutionKind.ELECTRONIC_INVOICE,
  ): Promise<CreateJarvisInvoiceResponseDto> {
    const isDebitNote = kind === JarvisResolutionKind.DEBIT_NOTE;
    const isNote = kind === JarvisResolutionKind.CREDIT_NOTE || isDebitNote;
    const isSupport = kind === JarvisResolutionKind.SUPPORT_DOCUMENT;
    const documentLabel = isDebitNote ? "nota débito" : isNote ? "nota crédito" : isSupport ? "documento soporte" : "factura de venta";
    const issueDate = request.issueDate?.trim();
    const customerIdentification = normalizeJarvisDocumentNumber(
      request.customerIdentification ?? '',
    );
    const currency = (request.currency?.trim() || 'COP').toUpperCase();
    const items = Array.isArray(request.items) ? request.items : [];

    if (!issueDate) {
      throw new BadRequestException('La fecha de expedición es obligatoria.');
    }

    if (!customerIdentification) {
      throw new BadRequestException(isSupport ? "Debe seleccionar un proveedor." : "Debe seleccionar un cliente.");
    }

    if (items.length === 0) {
      throw new BadRequestException(
        'Debe agregar al menos un producto o servicio.',
      );
    }

    if (isNote) {
      const reference = request.billingReference;
      const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
      if (!reference?.number?.trim() || !/^[a-f0-9]{96}$/i.test(reference?.uuid?.trim() ?? '') || !validDate(reference?.issueDate ?? '') || !validDate(issueDate) || reference.issueDate > issueDate) {
        throw new BadRequestException('Indique el número, CUFE y fecha válidos de la factura afectada.');
      }
      if (!Number.isSafeInteger(request.discrepancyResponseCode) || request.discrepancyResponseCode! < 1 || !request.discrepancyResponseDescription?.trim()) {
        throw new BadRequestException('Indique el código y la descripción del motivo de la nota crédito.');
      }
    }

    const documentType = normalizeJarvisDocumentType(
      request.customerDocumentType,
    );

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

    const tercero =
      await this.jarvisTercerosRepository.findByCompanyAndDocument(
        companyId,
        documentType,
        customerIdentification,
      );

    if (!tercero) {
      throw new BadRequestException(
        `Debe crear el tercero en Jarvis antes de enviar el documento.`,
      );
    }

    const company = await this.companiesRepository.findById(companyId);
    if (!company) throw new NotFoundException('Empresa no encontrada.');
    const companyToken = company.nextPymeToken?.trim();
    if (!companyToken) {
      throw new BadRequestException(
        `Configura el token de NextPyme de esta empresa antes de emitir ${documentLabel}.`,
      );
    }
    const credentials = normalizeJarvisCredentials(integration.credentials);

    const defaultTaxId = this.nextPymeMasterCatalogService.getIvaTaxId();
    const allowedTaxIds = new Set([defaultTaxId]);
    if (items.some((item) => item.taxId != null && item.taxId !== defaultTaxId)) {
      const catalogTaxes = await this.nextPymeMasterCatalogService.getTaxes();
      for (const tax of catalogTaxes) allowedTaxIds.add(tax.id);
    }

    const parsedItems = items.map((item, index) => {
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
      const taxId = item.taxId ?? defaultTaxId;
      if (!Number.isSafeInteger(taxId) || !allowedTaxIds.has(taxId)) {
        throw new BadRequestException(`El impuesto del ítem ${index + 1} no está disponible en el catálogo de facturación.`);
      }

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

      if (isNote && (!Number.isFinite(discount) || !Number.isFinite(taxAmount) || discount > quantity * unitValue || Number(item.discount ?? 0) < 0 || Number(item.taxAmount ?? 0) < 0)) {
        throw new BadRequestException('El descuento o impuesto del ítem no es válido.');
      }
      return {
        description,
        quantity,
        unitValue,
        discount,
        taxAmount,
        taxId,
        retention: item.retention,
        code: item.code?.trim() || `ITEM-${index + 1}`,
        notes: item.notes?.trim(),
      };
    });

    const resolutionLockKey = `jarvis-resolution:${companyId}:${kind}`;

    try {
      return await withPostgresAdvisoryLock(
        this.dataSource,
        resolutionLockKey,
        async () => {
          const numbering =
            await this.jarvisSetupService.allocateResolutionNumber(
              companyId,
              kind,
            );

          const municipalityId =
            tercero.municipalityId ??
            (await this.nextPymeMasterCatalogService.resolveMunicipalityId(
              credentials.municipality,
              credentials.city ?? company?.name,
            ));
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
            tercero.typeRegimeId ??
            (await this.nextPymeMasterCatalogService.resolveRegimeId(
              terceroVatRegime ?? JarvisVatRegime.RESPONSIBLE,
            ));
          const currencyId =
            await this.nextPymeMasterCatalogService.resolveCurrencyId(currency);

          this.logger.log(
            `[companyId=${companyId}] Numeración local ${documentLabel} ${JSON.stringify(
              {
                prefix: numbering.prefix,
                number: numbering.number,
                municipalityId,
                liabilityId,
                regimeId,
              },
            )}`,
          );

          const documentDiscount = Math.max(
            0,
            Number(request.discountAmount ?? 0),
          );

          const lineExtensionTotal = parsedItems.reduce(
            (sum, item) =>
              sum + toMoney(item.quantity * item.unitValue - item.discount),
            0,
          );
          if (isNote && (!Number.isFinite(Number(request.discountAmount ?? 0)) || Number(request.discountAmount ?? 0) < 0 || documentDiscount > lineExtensionTotal + parsedItems.reduce((sum, item) => sum + item.taxAmount, 0))) {
            throw new BadRequestException('El descuento general no puede ser negativo ni superar el total de la nota.');
          }
          const taxableBase = toMoney(lineExtensionTotal - (isDebitNote ? 0 : documentDiscount));
          const ivaTotal = toMoney(
            parsedItems.reduce((sum, item) => sum + item.taxAmount, 0),
          );
          const payable = toMoney(taxableBase + ivaTotal - (isDebitNote ? documentDiscount : 0));

          const taxTotals = buildJarvisInvoiceChargeTaxTotals(parsedItems);
          const withholdingTotals: typeof taxTotals = [];
          const retentionEntries = [
            ...(request.retentions ?? []).map(retention => ({ retention, base: taxableBase, iva: ivaTotal })),
            ...parsedItems.filter(item => item.retention).map(item => ({
              retention: item.retention!, base: toMoney(item.quantity * item.unitValue - item.discount), iva: item.taxAmount,
            })),
          ];

          for (const { retention, base, iva } of retentionEntries) {
            if (!retention?.id || !Number.isFinite(retention.id)) {
              continue;
            }

            const percentage = Number(retention.percentage ?? 0);
            if (!Number.isFinite(percentage) || percentage < 0) throw new BadRequestException('La tarifa de retención no es válida.');
            const calculated = calculateJarvisRetention(retention.type ?? '', percentage, base, iva);

            const existing = withholdingTotals.find(tax => tax.tax_id === retention.id && Number(tax.percent) === calculated.percent);
            if (existing) {
              existing.tax_amount = formatMoney(Number(existing.tax_amount) + calculated.amount);
              existing.taxable_amount = formatMoney(Number(existing.taxable_amount) + calculated.base);
              continue;
            }
            withholdingTotals.push({
              tax_id: retention.id,
              tax_amount: formatMoney(calculated.amount),
              taxable_amount: formatMoney(calculated.base),
              percent: String(calculated.percent),
            });
          }

          const invoiceLines = parsedItems.map((item) => {
            const lineExtension = toMoney(
              item.quantity * item.unitValue - item.discount,
            );

            return {
              unit_measure_id:
                this.nextPymeMasterCatalogService.getDefaultUnitMeasureId(),
              invoiced_quantity: item.quantity,
              line_extension_amount: formatMoney(lineExtension),
              free_of_charge_indicator: false,
              description: item.description,
              ...(item.notes ? { notes: item.notes } : {}),
              ...(isNote && item.discount > 0 ? { allowance_charges: [{
                charge_indicator: false, allowance_charge_reason: 'DESCUENTO',
                amount: formatMoney(item.discount), base_amount: formatMoney(item.quantity * item.unitValue),
              }] } : {}),
              code: item.code,
              type_item_identification_id:
                this.nextPymeMasterCatalogService.getDefaultItemIdentificationId(),
              price_amount: formatMoney(toMoney(item.unitValue)),
              base_quantity: item.quantity,
              ...(isSupport ? { type_generation_transmition_id: 1, start_date: issueDate } : {}),
              ...(item.taxAmount > 0
                ? {
                    tax_totals: [
                      {
                        tax_id: item.taxId,
                        tax_amount: formatMoney(item.taxAmount),
                        taxable_amount: formatMoney(lineExtension),
                        percent: formatMoney(
                          lineExtension > 0
                            ? (item.taxAmount / lineExtension) * 100
                            : 0,
                        ),
                      },
                    ],
                  }
                : {}),
            };
          });

          const paymentDueDate = request.payment?.due_date?.trim() || issueDate;

          const payload = {
            type_document_id:
              isDebitNote ? 5 : isNote ? 4 : isSupport ? this.nextPymeMasterCatalogService.getSupportDocumentTypeId() : this.nextPymeMasterCatalogService.getElectronicInvoiceTypeId(),
            number: numbering.number,
            date: issueDate,
            ...((isSupport || isNote) ? { time: new Date().toLocaleTimeString("en-GB", { timeZone: "America/Bogota", hour12: false }), sendmail: false, sendmailtome: false } : {}),
            ...(isNote ? {
              billing_reference: { number: request.billingReference!.number.trim(), uuid: request.billingReference!.uuid.trim(), issue_date: request.billingReference!.issueDate },
              discrepancyresponsecode: request.discrepancyResponseCode,
              discrepancyresponsedescription: request.discrepancyResponseDescription!.trim(),
              sendmail: request.sendmail === true,
              sendmailtome: request.sendmailtome === true,
              ...(request.seze?.trim() ? { seze: request.seze.trim() } : {}),
            } : {}),
            prefix: numbering.prefix,
            ...(numbering.formNumber ? { resolution_number: numbering.formNumber } : {}),
            ...(currencyId ? { type_currency_id: currencyId } : {}),
            ...(request.observations?.trim()
              ? { notes: request.observations.trim() }
              : {}),
            ...(request.headNote?.trim()
              ? { head_note: request.headNote.trim() }
              : {}),
            ...(request.footNote?.trim()
              ? { foot_note: request.footNote.trim() }
              : {}),
            customer: {
              ...(isNote ? { merchant_registration: '0000000-00' } : {}),
              identification_number: Number(tercero.documentNumber),
              ...(tercero.checkDigit
                ? { dv: Number(tercero.checkDigit) || tercero.checkDigit }
                : {}),
              name: request.customerName?.trim() || tercero.name,
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
            ...(!isNote && request.payment?.id
              ? {
                  payment_form: {
                    payment_form_id: request.payment.payment_form_id ?? 1,
                    payment_method_id: request.payment.id,
                    payment_due_date: paymentDueDate,
                    duration_measure: String(
                      daysBetweenLocalDates(issueDate, paymentDueDate),
                    ),
                  },
                }
              : {}),
            ...(documentDiscount > 0
              ? {
                  allowance_charges: [
                    {
                      discount_id: 1,
                      charge_indicator: false,
                      allowance_charge_reason: 'DESCUENTO GENERAL',
                      amount: formatMoney(documentDiscount),
                      base_amount: formatMoney(isDebitNote ? lineExtensionTotal + ivaTotal : lineExtensionTotal),
                    },
                  ],
                }
              : {}),
            legal_monetary_totals: {
              line_extension_amount: formatMoney(lineExtensionTotal),
              tax_exclusive_amount: formatMoney(taxableBase),
              tax_inclusive_amount: formatMoney(payable),
              payable_amount: formatMoney(payable),
              allowance_total_amount: formatMoney(documentDiscount),
              charge_total_amount: '0.00',
            },
            ...(taxTotals.length > 0 ? { tax_totals: taxTotals } : {}),
            ...(withholdingTotals.length ? { with_holding_tax_total: withholdingTotals } : {}),
            invoice_lines: invoiceLines,
          };

          this.logger.log(
            `[companyId=${companyId}] Body ${documentLabel} -> NextPyme ${JSON.stringify(
              payload,
              null,
              2,
            )}`,
          );

          const { customer, ...supportPayload } = payload;
          const { invoice_lines, ...creditPayload } = payload;
          const { legal_monetary_totals, prefix: _prefix, resolution_number: _resolution, ...debitPayload } = creditPayload;
          const created = await (isDebitNote
            ? this.nextPymeApiClient.createDebitNote({ ...debitPayload,
                requested_monetary_totals: { ...legal_monetary_totals,
                  tax_exclusive_amount: formatMoney(lineExtensionTotal),
                  tax_inclusive_amount: formatMoney(lineExtensionTotal + ivaTotal),
                }, debit_note_lines: invoice_lines }, companyToken)
            : isNote
            ? this.nextPymeApiClient.createCreditNote({ ...creditPayload, credit_note_lines: invoice_lines }, companyToken)
            : isSupport
            ? this.nextPymeApiClient.createSupportDocument({ ...supportPayload, seller: customer }, companyToken)
            : this.nextPymeApiClient.createInvoice(payload, companyToken)).catch(async (error: unknown) => {
                if (
                  error instanceof BadGatewayException &&
                  /documento\s+procesado\s+anteriormente/i.test(error.message)
                ) {
                  // El número ya está ocupado en DIAN. Avanzar bajo el mismo
                  // bloqueo de resolución, conservando el rechazo del envío.
                  await this.jarvisSetupService.commitResolutionNumber(
                    companyId,
                    kind,
                    numbering.number,
                  );
                }
                throw error;
              });

          this.logger.log(
            `[companyId=${companyId}] Respuesta NextPyme ${JSON.stringify(created)}`,
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
          const createdCufe = readNextPymeCreatedUniqueCode(created);

          let historyId: string | undefined;
          let invoiceXml: string | null = null;
          if (!isSupport && !isNote) {
            try { invoiceXml = extractNextPymeInvoiceXml(created); } catch { /* Retrieve by CUFE when opening the PDF if emission did not include XML. */ }
          }
          // Un fallo de historial no convierte una emision aceptada en un error ni invita a reenviarla.
          try {
            historyId = await this.invoiceHistory.record({
              invoiceXml,
              sourceRequest: JSON.parse(JSON.stringify(request)) as CreateJarvisInvoiceRequestDto,
              companyId, documentKind: kind, providerId: createdId, prefix: numbering.prefix, number: String(createdNumber),
              issueDate, customerName: request.customerName?.trim() || tercero.name,
              customerIdentification, currency, total: formatMoney(payable), cufe: createdCufe,
            });
          } catch (historyError) {
            this.logger.error('No se pudo registrar la factura aceptada ' + createdConsecutive, historyError);
          }

          await this.jarvisSetupService.commitResolutionNumber(
            companyId,
            kind,
            createdNumber,
          );

          this.logger.log(
            `[companyId=${companyId}] ${documentLabel} enviado a NextPyme (id=${createdId}, consecutive=${createdConsecutive}, number=${createdNumber}, cufe=${createdCufe ?? 'n/a'})`,
          );

          return {
            success: true,
            invoice: {
              historyId,
              id: createdId,
              number: createdNumber,
              consecutive: createdConsecutive,
              prefix: numbering.prefix,
              date: issueDate,
              cufe: createdCufe,
            },
          };
        },
      );
    } catch (error) {
      this.logger.error(
        `[companyId=${companyId}] Error al enviar ${documentLabel} a NextPyme`,
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
          : `Error inesperado al crear ${documentLabel}.`,
      );
    }
  }
}
