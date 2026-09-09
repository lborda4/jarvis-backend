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
import { JarvisSetupService } from './jarvis-setup.service';
import { NextPymeApiClient } from './nextpyme/nextpyme-api.client';
import { NextPymeMasterCatalogService } from './nextpyme/nextpyme-master-catalog.service';

const DOCUMENT_TYPE_IDENTIFICATION_FALLBACK: Record<string, number> = {
  [JarvisDocumentType.CC]: 3,
  [JarvisDocumentType.CE]: 5,
  [JarvisDocumentType.NIT]: 6,
  [JarvisDocumentType.PA]: 7,
};

/**
 * Emite una Factura de venta electrónica directo contra NextPyme/DIAN —
 * llenar y enviar de una vez, sin pasar por el modelo de ElectronicDocument
 * (a diferencia de Documento Soporte, que se guarda como borrador primero).
 * Decisión explícita del usuario: alcance simple, sin listado/borrador
 * propios. Por lo mismo, esta emisión NO pasa por
 * PlanSubscriptionService.assertCanCreateDocuments — ElectronicDocumentType
 * no tiene un valor para factura de venta, así que no hay contra qué
 * contarla en los límites del plan todavía.
 */
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
  ) {}

  async createAndSendInvoice(
    request: CreateJarvisInvoiceRequestDto,
    companyId: string,
  ): Promise<CreateJarvisInvoiceResponseDto> {
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
      throw new BadRequestException('Debe seleccionar un cliente.');
    }

    if (items.length === 0) {
      throw new BadRequestException(
        'Debe agregar al menos un producto o servicio.',
      );
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
        'Debe crear el cliente en Jarvis antes de enviar la factura de venta.',
      );
    }

    const company = await this.companiesRepository.findById(companyId);
    const credentials = normalizeJarvisCredentials(integration.credentials);

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

      return {
        description,
        quantity,
        unitValue,
        discount,
        taxAmount,
        code: item.code?.trim() || `ITEM-${index + 1}`,
        notes: item.notes?.trim(),
      };
    });

    const resolutionLockKey = `jarvis-resolution:${companyId}:${JarvisResolutionKind.ELECTRONIC_INVOICE}`;

    try {
      return await withPostgresAdvisoryLock(
        this.dataSource,
        resolutionLockKey,
        async () => {
          const numbering =
            await this.jarvisSetupService.allocateResolutionNumber(
              companyId,
              JarvisResolutionKind.ELECTRONIC_INVOICE,
            );

          // Igual que en Documento Soporte: sin dato de ciudad propio del
          // cliente (JarvisTercero no lo guarda hoy), se resuelve con los
          // mismos datos de la empresa emisora — mismo fallback ya aceptado
          // ahí, ver JarvisSupportDocumentSendService.sendSupportDocument.
          const municipalityId =
            await this.nextPymeMasterCatalogService.resolveMunicipalityId(
              credentials.municipality,
              credentials.city ?? company?.name,
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
          const currencyId =
            await this.nextPymeMasterCatalogService.resolveCurrencyId(currency);

          this.logger.log(
            `[companyId=${companyId}] Numeración local factura de venta ${JSON.stringify(
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
          const taxableBase = toMoney(lineExtensionTotal - documentDiscount);
          const ivaTotal = toMoney(
            parsedItems.reduce((sum, item) => sum + item.taxAmount, 0),
          );
          const payable = toMoney(taxableBase + ivaTotal);

          const taxTotals =
            ivaTotal > 0
              ? [
                  {
                    tax_id: this.nextPymeMasterCatalogService.getIvaTaxId(),
                    tax_amount: formatMoney(ivaTotal),
                    taxable_amount: formatMoney(taxableBase),
                    percent: formatMoney(
                      taxableBase > 0 ? (ivaTotal / taxableBase) * 100 : 0,
                    ),
                  },
                ]
              : [];

          for (const retention of request.retentions ?? []) {
            if (!retention?.id || !Number.isFinite(retention.id)) {
              continue;
            }

            const percentage = Number(retention.percentage ?? 0);
            const retentionAmount =
              percentage > 0 ? toMoney((taxableBase * percentage) / 100) : 0;

            taxTotals.push({
              tax_id: retention.id,
              tax_amount: formatMoney(retentionAmount),
              taxable_amount: formatMoney(taxableBase),
              percent: formatMoney(percentage),
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
              code: item.code,
              type_item_identification_id:
                this.nextPymeMasterCatalogService.getDefaultItemIdentificationId(),
              price_amount: formatMoney(toMoney(item.unitValue)),
              base_quantity: item.quantity,
              type_generation_transmition_id:
                this.nextPymeMasterCatalogService.getDefaultGenerationTransmissionId(),
              start_date: issueDate,
              ...(item.taxAmount > 0
                ? {
                    tax_totals: [
                      {
                        tax_id: this.nextPymeMasterCatalogService.getIvaTaxId(),
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
              this.nextPymeMasterCatalogService.getElectronicInvoiceTypeId(),
            number: numbering.number,
            date: issueDate,
            prefix: numbering.prefix,
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
            ...(request.payment?.id
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
                      base_amount: formatMoney(lineExtensionTotal),
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
            invoice_lines: invoiceLines,
          };

          this.logger.log(
            `[companyId=${companyId}] Body factura de venta -> NextPyme ${JSON.stringify(
              payload,
              null,
              2,
            )}`,
          );

          const created = await this.nextPymeApiClient.createInvoice(payload);

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

          await this.jarvisSetupService.commitResolutionNumber(
            companyId,
            JarvisResolutionKind.ELECTRONIC_INVOICE,
            createdNumber,
          );

          this.logger.log(
            `[companyId=${companyId}] Factura de venta enviada a NextPyme (id=${createdId}, consecutive=${createdConsecutive}, number=${createdNumber}, cufe=${createdCufe ?? 'n/a'})`,
          );

          return {
            success: true,
            invoice: {
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
        `[companyId=${companyId}] Error al enviar Factura de venta a NextPyme`,
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
          : 'Error inesperado al crear la Factura de venta.',
      );
    }
  }
}
