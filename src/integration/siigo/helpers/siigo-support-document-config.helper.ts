import { BadRequestException } from '@nestjs/common';
import { SIIGO_SUPPORT_DOCUMENT_SEND_STAMP_ENABLED } from '../constants/siigo.constants';
import { Integration } from '../../entities/integration.entity';
import { IntegrationConfiguration } from '../../interfaces/integration-configuration.interface';

export interface SiigoSupportDocumentConfig {
  documentId: number;
  paymentTypeId: number;
  defaultTaxId: number;
  sendStamp: boolean;
}

const REQUIRED_SUPPORT_DOCUMENT_CONFIGURATION_FIELDS = [
  'supportDocumentId',
  'paymentTypeId',
  'defaultTaxId',
] as const satisfies ReadonlyArray<keyof IntegrationConfiguration>;

type RequiredSupportDocumentConfigurationField =
  (typeof REQUIRED_SUPPORT_DOCUMENT_CONFIGURATION_FIELDS)[number];

function isValidConfigurationNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function getMissingSupportDocumentConfigurationFields(
  configuration: IntegrationConfiguration | null | undefined,
): RequiredSupportDocumentConfigurationField[] {
  if (!configuration) {
    return [...REQUIRED_SUPPORT_DOCUMENT_CONFIGURATION_FIELDS];
  }

  return REQUIRED_SUPPORT_DOCUMENT_CONFIGURATION_FIELDS.filter((field) => {
    return !isValidConfigurationNumber(configuration[field]);
  });
}

export function resolveSiigoSupportDocumentConfig(
  integration: Integration,
  companyId?: string,
): SiigoSupportDocumentConfig {
  const missingFields = getMissingSupportDocumentConfigurationFields(
    integration.configuration,
  );

  if (missingFields.length > 0) {
    const companySuffix = companyId ? ` para la empresa ${companyId}` : '';

    throw new BadRequestException(
      `La integración SIIGO no tiene la configuración requerida para Documento Soporte${companySuffix}. Faltan o son inválidos: ${missingFields.map((field) => `configuration.${field}`).join(', ')}. Configure el campo configuration en la tabla integrations.`,
    );
  }

  const configuration = integration.configuration;

  return {
    documentId: configuration.supportDocumentId as number,
    paymentTypeId: configuration.paymentTypeId as number,
    defaultTaxId: configuration.defaultTaxId as number,
    sendStamp:
      configuration.supportDocumentSendStamp ??
      SIIGO_SUPPORT_DOCUMENT_SEND_STAMP_ENABLED,
  };
}
