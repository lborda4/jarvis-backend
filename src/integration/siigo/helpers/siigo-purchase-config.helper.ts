import { BadRequestException } from '@nestjs/common';
import { Integration } from '../../entities/integration.entity';
import { IntegrationConfiguration } from '../../interfaces/integration-configuration.interface';

export interface SiigoPurchaseConfig {
  documentId: number;
  purchaseNumber?: number;
  paymentTypeId: number;
  defaultTaxId: number;
  costCenter?: number;
}

const REQUIRED_PURCHASE_CONFIGURATION_FIELDS = [
  'purchaseDocumentId',
  'paymentTypeId',
  'defaultTaxId',
] as const satisfies ReadonlyArray<keyof IntegrationConfiguration>;

type RequiredPurchaseConfigurationField =
  (typeof REQUIRED_PURCHASE_CONFIGURATION_FIELDS)[number];

function isValidConfigurationNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function getMissingPurchaseConfigurationFields(
  configuration: IntegrationConfiguration | null | undefined,
): RequiredPurchaseConfigurationField[] {
  if (!configuration) {
    return [...REQUIRED_PURCHASE_CONFIGURATION_FIELDS];
  }

  return REQUIRED_PURCHASE_CONFIGURATION_FIELDS.filter((field) => {
    return !isValidConfigurationNumber(configuration[field]);
  });
}

export function resolveSiigoPurchaseConfig(
  integration: Integration,
  companyId?: string,
): SiigoPurchaseConfig {
  const missingFields = getMissingPurchaseConfigurationFields(
    integration.configuration,
  );

  if (missingFields.length > 0) {
    const companySuffix = companyId
      ? ` para la empresa ${companyId}`
      : '';

    throw new BadRequestException(
      `La integración SIIGO no tiene la configuración requerida${companySuffix}. Faltan o son inválidos: ${missingFields.map((field) => `configuration.${field}`).join(', ')}. Configure el campo configuration en la tabla integrations.`,
    );
  }

  const configuration = integration.configuration;

  return {
    documentId: configuration.purchaseDocumentId as number,
    paymentTypeId: configuration.paymentTypeId as number,
    defaultTaxId: configuration.defaultTaxId as number,
    ...(isValidConfigurationNumber(configuration.purchaseNumber)
      ? { purchaseNumber: configuration.purchaseNumber }
      : {}),
    ...(isValidConfigurationNumber(configuration.costCenter)
      ? { costCenter: configuration.costCenter }
      : {}),
  };
}
