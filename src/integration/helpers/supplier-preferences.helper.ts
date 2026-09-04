import { ElectronicDocumentStatus } from '../../electronic-document/enums/electronic-document-status.enum';
import { resolveSendConfigurationFromPayload } from '../../electronic-document/helpers/electronic-document-send-configuration.helper';
import { ElectronicDocumentPayload } from '../../electronic-document/interfaces/electronic-document-payload.interface';
import { SupplierConfiguration } from '../entities/supplier-configuration.entity';
import { SupplierItemAccountMapping } from '../entities/supplier-item-account-mapping.entity';
import {
  SupplierCostCenterPreference,
  SupplierPaymentMethodPreference,
  SupplierRetentionPreference,
} from '../interfaces/supplier-mapping-value.interface';
import {
  buildSupplierConfigurationKey,
  SuggestedAccount,
} from './supplier-accounts-catalog.helper';
import { buildSupplierItemAccountMappingKey } from './supplier-item-account-mapping.helper';
import {
  resolveSuggestedAccountForItem,
  resolveSuggestedAccountFromPreference,
  resolveSuggestedCostCenterFromPreference,
  resolveSuggestedItemConfigFromConfiguration,
  resolveSuggestedPaymentMethodFromPreference,
  resolveSuggestedPaymentMethodFromSync,
  resolveSuggestedRetentionsFromPreference,
  resolveSuggestedRetentionsFromSync,
  SuggestedItemAccount,
  SuggestedProduct,
  SuggestedPurchaseItemConfig,
} from './supplier-preference.helper';

export interface SupplierDocumentIdentity {
  companyId: string;
  status?: string;
  documentNumberThird: string | null;
  payload: Pick<
    ElectronicDocumentPayload,
    'supplier' | 'siigoSendConfiguration' | 'aiSuggestion' | 'items'
  >;
}

export function resolveSupplierConfigurationForDocument(
  document: SupplierDocumentIdentity,
  configurationIndex: Map<string, SupplierConfiguration>,
  integrationId: string,
): SupplierConfiguration | null {
  const supplierDocument = (
    document.documentNumberThird ??
    document.payload.supplier.documentNumber ??
    ''
  ).replace(/[^\d]/g, '');
  const supplierDocumentType =
    document.payload.supplier.documentType?.trim() || 'NIT';

  if (!supplierDocument) {
    return null;
  }

  return (
    configurationIndex.get(
      buildSupplierConfigurationKey(
        document.companyId,
        integrationId,
        supplierDocumentType,
        supplierDocument,
      ),
    ) ?? null
  );
}

/** Cuenta sugerida por ítem — ver resolveSuggestedAccountForItem para el
 * orden de resolución (regla exacta proveedor+descripción, luego fallback
 * de proveedor marcado como sugerencia, luego null). Una entrada por cada
 * `document.payload.items[]`, en el mismo orden. */
export function resolveSuggestedAccountsForDocumentItems(
  document: SupplierDocumentIdentity,
  configurationIndex: Map<string, SupplierConfiguration>,
  itemMappingIndex: Map<string, SupplierItemAccountMapping>,
  integrationId: string,
): Array<SuggestedItemAccount | null> {
  const configuration = resolveSupplierConfigurationForDocument(
    document,
    configurationIndex,
    integrationId,
  );

  const supplierDocument = (
    document.documentNumberThird ??
    document.payload.supplier.documentNumber ??
    ''
  ).replace(/[^\d]/g, '');
  const supplierDocumentType =
    document.payload.supplier.documentType?.trim() || 'NIT';

  return (document.payload.items ?? []).map((item) => {
    const itemMapping = supplierDocument
      ? itemMappingIndex.get(
          buildSupplierItemAccountMappingKey(
            document.companyId,
            integrationId,
            supplierDocumentType,
            supplierDocument,
            item.descripcion,
          ),
        )
      : undefined;

    return resolveSuggestedAccountForItem(itemMapping, configuration);
  });
}

export function resolveSuggestedAccountForDocument(
  document: SupplierDocumentIdentity,
  configurationIndex: Map<string, SupplierConfiguration>,
  itemMappingIndex: Map<string, SupplierItemAccountMapping>,
  integrationId: string,
): SuggestedAccount | null {
  if (document.status === ElectronicDocumentStatus.PURCHASE_CREATED) {
    const sendConfiguration = resolveSendConfigurationFromPayload(
      document.payload,
    );

    if (sendConfiguration) {
      return {
        code: sendConfiguration.account.code,
        name: sendConfiguration.account.name,
        uses: 1,
      };
    }

    // Sin configuración de envío confirmada (factura ya creada en SIIGO por
    // otra vía — ej. detectada por provider_invoice al importar, nunca
    // enviada desde acá — y sin líneas propias en historial_facturas
    // todavía, ver historialSnapshot en electronic-document.service.ts):
    // no hay NADA confirmado que proteger, así que en vez de dejarla vacía
    // cae a las mismas reglas de un documento normal (IA, regla exacta por
    // ítem, historial del proveedor) — nunca debería faltar una cuenta sin
    // que sea porque genuinamente no hay ninguna señal confiable. Sigue
    // sin entrar acá arriba: no hay `return` — cae al resto de la función.
  }

  if (document.payload.aiSuggestion?.account) {
    return {
      code: document.payload.aiSuggestion.account.code,
      name: document.payload.aiSuggestion.account.name,
      uses: 1,
    };
  }

  const items = document.payload.items;

  // Sin ítems (o documento sin línea alguna todavía): cae al fallback de
  // proveedor de siempre, para no perder la sugerencia en casos borde.
  if (!Array.isArray(items) || items.length === 0) {
    const configuration = resolveSupplierConfigurationForDocument(
      document,
      configurationIndex,
      integrationId,
    );

    return resolveSuggestedAccountFromPreference(configuration);
  }

  const perItemAccounts = resolveSuggestedAccountsForDocumentItems(
    document,
    configurationIndex,
    itemMappingIndex,
    integrationId,
  );

  // Columna-resumen de una lista de documentos: solo tiene sentido mostrar
  // UN valor si todos los ítems del documento coinciden en la misma cuenta
  // — si difieren (proveedor con varios conceptos, cada uno a su cuenta),
  // mostrar cualquiera de ellas sería engañoso; se deja en blanco y el
  // detalle del documento muestra la cuenta real de cada ítem.
  const [first, ...rest] = perItemAccounts;

  if (!first || rest.some((account) => account?.code !== first.code)) {
    return null;
  }

  return { code: first.code, name: first.name, uses: 1 };
}

/**
 * Sugerencia de producto a nivel documento (columna-resumen de listados) —
 * a diferencia de la cuenta, no hay un mapeo por ítem persistido en BD para
 * productos (ver SupplierItemAccountMapping, exclusivo de cuenta PUC): la
 * única fuente es la clasificación de IA (`aiSuggestion.product`), guardada
 * por SiigoPurchaseAiClassificationService solo cuando el ítem clasifica
 * como 'Product'. El fallback de proveedor por historial (campoVariabilidad)
 * se resuelve a nivel de ítem en el frontend vía `suggestedItemConfig.productCode`.
 */
export function resolveSuggestedProductForDocument(
  document: SupplierDocumentIdentity,
): SuggestedProduct | null {
  const product = document.payload.aiSuggestion?.product;
  const code = product?.code?.trim();

  if (!code) {
    return null;
  }

  return { code, name: product?.name?.trim() || code };
}

export function resolveSuggestedPaymentMethodForDocument(
  document: SupplierDocumentIdentity,
  configurationIndex: Map<string, SupplierConfiguration>,
  integrationId: string,
): SupplierPaymentMethodPreference | null {
  if (document.status === ElectronicDocumentStatus.PURCHASE_CREATED) {
    return (
      resolveSendConfigurationFromPayload(document.payload)?.paymentMethod ??
      null
    );
  }

  const configuration = resolveSupplierConfigurationForDocument(
    document,
    configurationIndex,
    integrationId,
  );

  return (
    resolveSuggestedPaymentMethodFromSync(configuration) ??
    resolveSuggestedPaymentMethodFromPreference(configuration)
  );
}

export function resolveSuggestedRetentionsForDocument(
  document: SupplierDocumentIdentity,
  configurationIndex: Map<string, SupplierConfiguration>,
  integrationId: string,
): SupplierRetentionPreference[] {
  if (document.status === ElectronicDocumentStatus.PURCHASE_CREATED) {
    return (
      resolveSendConfigurationFromPayload(document.payload)?.retentions ?? []
    );
  }

  if (document.payload.aiSuggestion) {
    return document.payload.aiSuggestion.retentions ?? [];
  }

  const configuration = resolveSupplierConfigurationForDocument(
    document,
    configurationIndex,
    integrationId,
  );

  return (
    resolveSuggestedRetentionsFromSync(configuration) ??
    resolveSuggestedRetentionsFromPreference(configuration) ??
    []
  );
}

export function resolveSuggestedCostCenterForDocument(
  document: SupplierDocumentIdentity,
  configurationIndex: Map<string, SupplierConfiguration>,
  integrationId: string,
): SupplierCostCenterPreference | null {
  if (document.status === ElectronicDocumentStatus.PURCHASE_CREATED) {
    return (
      resolveSendConfigurationFromPayload(document.payload)?.costCenter ?? null
    );
  }

  const configuration = resolveSupplierConfigurationForDocument(
    document,
    configurationIndex,
    integrationId,
  );

  return resolveSuggestedCostCenterFromPreference(configuration);
}

/** Ver el doc de `resolveSuggestedItemConfigFromConfiguration` — cada campo
 * se sugiere de forma independiente según su propia variabilidad calculada
 * por el sync de historial, no según un único booleano a nivel de
 * proveedor completo. */
export function resolveSuggestedItemConfigForDocument(
  document: SupplierDocumentIdentity,
  configurationIndex: Map<string, SupplierConfiguration>,
  integrationId: string,
): SuggestedPurchaseItemConfig | null {
  if (
    document.status === ElectronicDocumentStatus.PURCHASE_CREATED &&
    resolveSendConfigurationFromPayload(document.payload)
  ) {
    // Ya tiene una configuración CONFIRMADA de cuando se envió desde acá
    // (payload.siigoSendConfiguration) — no corresponde sugerir nada
    // genérico encima de un dato ya confirmado.
    return null;
  }

  // Antes CUALQUIER documento PURCHASE_CREATED devolvía null acá sin
  // excepción — para una factura ya creada en SIIGO por otra vía (detectada
  // por provider_invoice al importar, nunca enviada desde acá) que todavía
  // no tiene líneas propias en historial_facturas (ver historialSnapshot en
  // electronic-document.service.ts, que tiene prioridad sobre esto cuando
  // sí las tiene), eso dejaba la cuenta/IVA/Retefuente sin ninguna
  // sugerencia aunque el historial GENERAL del proveedor sí tuviera una
  // señal confiable — bug real reportado ("no me está trayendo la cuenta
  // contable cuando ya está creada en SIIGO").
  const configuration = resolveSupplierConfigurationForDocument(
    document,
    configurationIndex,
    integrationId,
  );

  return resolveSuggestedItemConfigFromConfiguration(configuration);
}
