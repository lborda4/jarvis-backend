import { Logger } from '@nestjs/common';
import {
  CreateSiigoSupportDocumentItemDto,
  CreateSiigoSupportDocumentPaymentDto,
  CreateSiigoSupportDocumentRequestDto,
  CreateSiigoSupportDocumentRetentionDto,
  CreateSiigoSupportDocumentSupplierPreferencesDto,
} from '../dto/create-siigo-support-document.dto';
import { SiigoTaxCatalogItemDto } from '../dto/list-siigo-taxes.dto';
import {
  normalizeSupplierCostCenterPreference,
  normalizeSupplierPaymentMethodPreference,
  normalizeSupplierRetentionPreferences,
} from '../../helpers/supplier-mapping-value.helper';
import { SupplierPreferenceSnapshot } from '../../interfaces/supplier-preference.interface';
import { ElectronicDocumentService } from '../../../electronic-document/electronic-document.service';
import { SiigoAccountMappingService } from '../siigo-account-mapping.service';

/**
 * Campos que necesita persistSupplierPreferencesFromSendRequest, comunes a
 * CreateSiigoPurchaseSendRequestDto y CreateSiigoSupportDocumentRequestDto.
 */
export interface SupplierPreferenceSourceRequest {
  documentId: string;
  items: CreateSiigoSupportDocumentItemDto[];
  payments: CreateSiigoSupportDocumentPaymentDto[];
  retentions?: CreateSiigoSupportDocumentRetentionDto[];
  cost_center?: number;
  supplierPreferences?: CreateSiigoSupportDocumentSupplierPreferencesDto;
}

export function buildSupplierPreferenceSnapshotFromSendRequest(
  request: CreateSiigoSupportDocumentRequestDto,
  taxesCatalog: SiigoTaxCatalogItemDto[],
): SupplierPreferenceSnapshot | null {
  const accountCode = request.items[0]?.code?.trim();

  if (!accountCode) {
    return null;
  }

  const taxesById = new Map(taxesCatalog.map((tax) => [tax.id, tax]));
  const snapshot = request.supplierPreferences;
  const paymentMethod = snapshot?.paymentMethod ?? {
    id: request.payments[0]?.id,
    name: '',
    type: '',
  };

  if (!paymentMethod?.id) {
    return null;
  }

  const retentions =
    snapshot?.retentions ??
    (request.retentions ?? []).map((retention) => {
      const tax = taxesById.get(retention.id);

      return {
        id: retention.id,
        name: tax?.name ?? `Retención ${retention.id}`,
        type: retention.type ?? tax?.type ?? '',
        percentage: tax?.percentage ?? 0,
      };
    });

  const normalizedPaymentMethod = normalizeSupplierPaymentMethodPreference({
    id: paymentMethod.id,
    name: paymentMethod.name?.trim() || `Medio ${paymentMethod.id}`,
    type: paymentMethod.type?.trim() || '',
    ...(paymentMethod.dueDate === undefined
      ? {}
      : { dueDate: paymentMethod.dueDate }),
  });

  if (!normalizedPaymentMethod) {
    return null;
  }

  const normalizedCostCenter = snapshot?.costCenter
    ? normalizeSupplierCostCenterPreference(snapshot.costCenter)
    : request.cost_center !== undefined
      ? normalizeSupplierCostCenterPreference({
          id: request.cost_center,
          code: String(request.cost_center),
          name: `Centro ${request.cost_center}`,
        })
      : null;

  return {
    account: {
      code: accountCode,
      name:
        snapshot?.accountDescription?.trim() ||
        request.items[0]?.description?.trim() ||
        accountCode,
    },
    paymentMethod: normalizedPaymentMethod,
    retentions: normalizeSupplierRetentionPreferences(retentions),
    ...(normalizedCostCenter ? { costCenter: normalizedCostCenter } : {}),
  };
}

/**
 * Guarda como preferencia del proveedor (cuenta, medio de pago, retenciones,
 * centro de costo) los valores elegidos en un request de envío a SIIGO, para
 * sugerirlos por defecto la próxima vez que se procese ese mismo proveedor.
 *
 * Compartido entre el envío de Factura de compra y Documento Soporte — antes
 * cada servicio tenía su propia copia de esta lógica.
 */
export async function persistSupplierPreferencesFromSendRequest(
  siigoAccountMappingService: SiigoAccountMappingService,
  request: SupplierPreferenceSourceRequest,
  electronicDocument: Awaited<
    ReturnType<ElectronicDocumentService['requireById']>
  >,
  companyId: string,
  taxesCatalog: SiigoTaxCatalogItemDto[],
  logger: Logger,
): Promise<void> {
  const accountCode = request.items[0]?.code?.trim();

  if (!accountCode) {
    return;
  }

  const taxesById = new Map(taxesCatalog.map((tax) => [tax.id, tax]));
  const snapshot = request.supplierPreferences;
  const paymentMethod = snapshot?.paymentMethod ?? {
    id: request.payments[0]?.id,
    name: '',
    type: '',
  };
  const retentions =
    snapshot?.retentions ??
    (request.retentions ?? []).map((retention) => {
      const tax = taxesById.get(retention.id);

      return {
        id: retention.id,
        name: tax?.name ?? `Retención ${retention.id}`,
        type: retention.type ?? tax?.type ?? '',
        percentage: tax?.percentage ?? 0,
      };
    });

  if (!paymentMethod.id) {
    return;
  }

  await siigoAccountMappingService.persistSupplierPreferencesForDocument(
    electronicDocument,
    companyId,
    {
      accountCode,
      accountDescription: snapshot?.accountDescription?.trim() || accountCode,
      paymentMethod: {
        id: paymentMethod.id,
        name: paymentMethod.name?.trim() || `Medio ${paymentMethod.id}`,
        type: paymentMethod.type?.trim() || '',
        ...(paymentMethod.dueDate === undefined
          ? {}
          : { dueDate: paymentMethod.dueDate }),
      },
      retentions,
      ...(snapshot?.costCenter
        ? {
            costCenter: {
              id: snapshot.costCenter.id,
              code: snapshot.costCenter.code,
              name: snapshot.costCenter.name,
            },
          }
        : request.cost_center !== undefined
          ? {
              costCenter: {
                id: request.cost_center,
                code: String(request.cost_center),
                name: `Centro ${request.cost_center}`,
              },
            }
          : {}),
    },
  );

  logger.log(
    `[documentId=${request.documentId}] Preferencias de proveedor guardadas`,
  );
}
