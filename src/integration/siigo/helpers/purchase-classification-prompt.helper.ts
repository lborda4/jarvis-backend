import type { OpenRouterMessage } from '../../openrouter/clients/openrouter-http.client';
import type { SiigoAccountCatalogItemDto } from '../dto/list-siigo-accounts.dto';
import type { SiigoTaxCatalogItemDto } from '../dto/list-siigo-taxes.dto';
import type { HistorialFacturaImpuestos } from '../../interfaces/historial-factura-impuestos.interface';
import {
  formatHistoricalExampleTarget,
  formatPromptHeader,
  type ClassificationDocumentKind,
} from './purchase-item-classification-prompt.helper';

export interface PurchaseClassificationPromptItem {
  descripcion: string;
  cantidad: number;
  valorUnitario: number;
}

export interface PurchaseClassificationHistoricalExample {
  descripcionItem: string;
  cuentaPuc: string;
  /** Nombre real de `siigo_accounts` para ese código. */
  cuentaNombre?: string | null;
  impuestos: HistorialFacturaImpuestos;
  /** true = corrección confirmada por el contador (más confiable que la sincronizada de SIIGO). */
  confirmadaPorContador: boolean;
}

export interface PurchaseClassificationPromptParams {
  supplierName: string;
  ourCompanyName?: string;
  ourCompanyDescription?: string | null;
  documentKind?: ClassificationDocumentKind | null;
  items: PurchaseClassificationPromptItem[];
  accounts: SiigoAccountCatalogItemDto[];
  /** Catálogo de impuestos IVA disponibles (para taxId). */
  taxes: SiigoTaxCatalogItemDto[];
  /** Catálogo de retenciones disponibles (Retefuente/ReteICA/Autorretención/ReteIVA) para retentionIds. */
  retentionTaxes?: SiigoTaxCatalogItemDto[];
  /** Últimas clasificaciones reales de ESTE proveedor, como ejemplos few-shot (pocas — no todo el historial). */
  historicalExamples?: PurchaseClassificationHistoricalExample[];
  /** false = el botón manual ya resolvió cuenta/producto con
   * classifyItemTypeAndAccount; este prompt solo pide IVA y retenciones. */
  includeAccount?: boolean;
}

export interface ParsedPurchaseClassification {
  accountCode: string | null;
  taxId: number | null;
  retentionIds: number[];
}

// Prompt deliberadamente corto: se manda en cada clasificación, así que su
// tamaño se multiplica por cada documento. Sin explicaciones de más, sin
// pedirle rationale/confidence — solo la sugerencia.
const SYSTEM_PROMPT = `Clasificas facturas de compra y documentos soporte colombianos para SIIGO. Dado ítems, catálogo de cuentas PUC, catálogo de IVA, catálogo de retenciones y (si hay) el histórico de facturas anteriores de este proveedor, elegís cuenta, un IVA y 0+ retenciones. Tené en cuenta a qué se dedica la empresa que compra para elegir la cuenta de ESTA empresa.

Reglas generales: usa SOLO ids/códigos que estén LITERALMENTE en los catálogos dados, nunca inventes uno. El histórico de facturas anteriores de ESTE proveedor es tu guía principal: esas líneas YA se contabilizaron. Si el concepto coincide o es equivalente (más las marcadas "confirmado"), repetí esa cuenta/IVA/retenciones. Si no hay línea equivalente, preferí una cuenta que este proveedor ya haya usado cuando encaje; si ninguna aplica, clasificá por el concepto de los ítems.

Cuenta: las cuentas PUC son categorías amplias de gasto/costo, no una descripción exacta del ítem — elegí SIEMPRE la cuenta del catálogo que mejor encaje por tipo de gasto, aunque el nombre no coincida palabra por palabra. OBLIGATORIO: accountCode NUNCA puede ser null ni "null"; siempre respondé un código del catálogo.

IVA y retenciones tienen efecto fiscal directo (montos que se declaran) y son más específicos: si no hay una opción segura, null (o [] en retentionIds) — acá sí mejor vacío que mal puesto.

Responde SOLO este JSON, sin texto extra: {"accountCode":string,"taxId":number|null,"retentionIds":number[]}`;

const SYSTEM_PROMPT_TAXES_ONLY = `Clasificas el IVA y las retenciones de una factura de compra o un documento soporte colombiano para SIIGO. La cuenta o el producto YA están resueltos por otra clasificación; NO elijas cuenta. Tené en cuenta a qué se dedica la empresa que compra si eso cambia el tratamiento fiscal.

Reglas: usa SOLO ids que estén LITERALMENTE en los catálogos dados. El histórico de facturas anteriores de ESTE proveedor es tu guía principal: si el concepto coincide (más las marcadas "confirmado"), repetí ese IVA/retenciones. Si no hay línea equivalente, usá el tratamiento fiscal que este proveedor ya tuvo cuando encaje. IVA y retenciones tienen efecto fiscal directo: si no hay una opción segura, taxId null y retentionIds [].

Responde SOLO este JSON, sin texto extra: {"taxId":number|null,"retentionIds":number[]}`;

function formatImpuestosSummary(impuestos: HistorialFacturaImpuestos): string {
  const parts: string[] = [];

  if (impuestos.iva) {
    parts.push(`IVA ${impuestos.iva.percentage}%`);
  }
  if (impuestos.retefuente) {
    parts.push(`Retefuente ${impuestos.retefuente.percentage}%`);
  }
  if (impuestos.reteica) {
    parts.push(`ReteICA ${impuestos.reteica.percentage}%`);
  }
  if (impuestos.autorretencion) {
    parts.push(`Autorretención ${impuestos.autorretencion.percentage}%`);
  }

  return parts.length > 0 ? parts.join(',') : 'sin impuestos';
}

export function buildPurchaseClassificationPrompt(
  params: PurchaseClassificationPromptParams,
): OpenRouterMessage[] {
  const itemsDescription = params.items
    .map(
      (item, index) => `${index + 1}. ${item.descripcion} (x${item.cantidad})`,
    )
    .join('\n');

  const accountsCatalog = params.accounts
    .map((account) => `${account.code} ${account.name}`)
    .join('\n');

  const taxesCatalog = params.taxes
    .map((tax) => `${tax.id}=${tax.name}(${tax.percentage}%)`)
    .join('\n');

  const retentionsCatalog = (params.retentionTaxes ?? [])
    .map((tax) => `${tax.id}=${tax.name}[${tax.type}](${tax.percentage}%)`)
    .join('\n');

  const historicalExamplesSection =
    params.historicalExamples && params.historicalExamples.length > 0
      ? `\nHistórico de facturas anteriores de este proveedor (concepto + código y nombre de cuenta):\n${params.historicalExamples
          .map(
            (example) =>
              `- Concepto: "${example.descripcionItem}" | Cuenta: ${formatHistoricalExampleTarget(example.cuentaPuc, example.cuentaNombre)},${formatImpuestosSummary(example.impuestos)}${
                example.confirmadaPorContador ? '(confirmado)' : ''
              }`,
          )
          .join('\n')}`
      : '';

  const includeAccount = params.includeAccount !== false;
  const companyContext = formatPromptHeader(
    params.ourCompanyName,
    params.ourCompanyDescription,
    params.documentKind,
  );
  const userContent = includeAccount
    ? `${companyContext}
Proveedor: ${params.supplierName}
Ítems:
${itemsDescription}

Cuentas PUC:
${accountsCatalog}

IVA:
${taxesCatalog || 'ninguno'}

Retenciones:
${retentionsCatalog || 'ninguna'}${historicalExamplesSection}`
    : `${companyContext}
Proveedor: ${params.supplierName}
Ítems:
${itemsDescription}

IVA:
${taxesCatalog || 'ninguno'}

Retenciones:
${retentionsCatalog || 'ninguna'}${historicalExamplesSection}`;

  return [
    {
      role: 'system',
      content: includeAccount ? SYSTEM_PROMPT : SYSTEM_PROMPT_TAXES_ONLY,
    },
    { role: 'user', content: userContent },
  ];
}

function extractJsonObject(rawText: string): string | null {
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');

  if (start === -1 || end === -1 || end < start) {
    return null;
  }

  return rawText.slice(start, end + 1);
}

function toFiniteNumberOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function toFiniteNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is number => typeof item === 'number' && Number.isFinite(item),
  );
}

const EMPTY_PARSED_RESULT: ParsedPurchaseClassification = {
  accountCode: null,
  taxId: null,
  retentionIds: [],
};

export function parsePurchaseClassificationResponse(
  rawText: string,
): ParsedPurchaseClassification {
  const jsonSlice = extractJsonObject(rawText);

  if (!jsonSlice) {
    return EMPTY_PARSED_RESULT;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    return EMPTY_PARSED_RESULT;
  }

  if (!parsed || typeof parsed !== 'object') {
    return EMPTY_PARSED_RESULT;
  }

  const record = parsed as Record<string, unknown>;
  const accountCode =
    typeof record.accountCode === 'string' && record.accountCode.trim()
      ? record.accountCode.trim()
      : null;
  const taxId = toFiniteNumberOrNull(record.taxId);
  const retentionIds = toFiniteNumberArray(record.retentionIds);

  return { accountCode, taxId, retentionIds };
}
