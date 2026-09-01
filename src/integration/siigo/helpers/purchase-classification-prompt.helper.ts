import type { OpenRouterMessage } from '../../openrouter/clients/openrouter-http.client';
import type { SiigoAccountCatalogItemDto } from '../dto/list-siigo-accounts.dto';
import type { SiigoTaxCatalogItemDto } from '../dto/list-siigo-taxes.dto';
import type { HistorialFacturaImpuestos } from '../../interfaces/historial-factura-impuestos.interface';

export interface PurchaseClassificationPromptItem {
  descripcion: string;
  cantidad: number;
  valorUnitario: number;
}

export interface PurchaseClassificationHistoricalExample {
  descripcionItem: string;
  cuentaPuc: string;
  impuestos: HistorialFacturaImpuestos;
  /** true = corrección confirmada por el contador (más confiable que la sincronizada de SIIGO). */
  confirmadaPorContador: boolean;
}

export interface PurchaseClassificationPromptParams {
  supplierName: string;
  items: PurchaseClassificationPromptItem[];
  accounts: SiigoAccountCatalogItemDto[];
  /** Catálogo de impuestos IVA disponibles (para taxId). */
  taxes: SiigoTaxCatalogItemDto[];
  /** Catálogo de retenciones disponibles (Retefuente/ReteICA/Autorretención/ReteIVA) para retentionIds. */
  retentionTaxes?: SiigoTaxCatalogItemDto[];
  /** Últimas clasificaciones reales de ESTE proveedor, como ejemplos few-shot (pocas — no todo el historial). */
  historicalExamples?: PurchaseClassificationHistoricalExample[];
}

export interface ParsedPurchaseClassification {
  accountCode: string | null;
  taxId: number | null;
  retentionIds: number[];
}

// Prompt deliberadamente corto: se manda en cada clasificación, así que su
// tamaño se multiplica por cada documento. Sin explicaciones de más, sin
// pedirle rationale/confidence — solo la sugerencia.
const SYSTEM_PROMPT = `Clasificas facturas de compra colombianas para SIIGO. Dado ítems, catálogo de cuentas PUC, catálogo de IVA, catálogo de retenciones y (si hay) ejemplos previos de este proveedor, elegís cuenta, un IVA y 0+ retenciones.

Reglas generales: usa SOLO ids/códigos que estén LITERALMENTE en los catálogos dados, nunca inventes uno. Si hay ejemplos previos, seguilos (más los marcados "confirmado").

Cuenta: las cuentas PUC son categorías amplias de gasto/costo, no una descripción exacta del ítem — elegí SIEMPRE la cuenta del catálogo que mejor encaje por tipo de gasto, aunque el nombre no coincida palabra por palabra. Dejá accountCode null solo si de verdad ninguna categoría del catálogo aplica.

IVA y retenciones tienen efecto fiscal directo (montos que se declaran) y son más específicos: si no hay una opción segura, null (o [] en retentionIds) — acá sí mejor vacío que mal puesto.

Responde SOLO este JSON, sin texto extra: {"accountCode":string|null,"taxId":number|null,"retentionIds":number[]}`;

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
      ? `\nEjemplos previos de este proveedor:\n${params.historicalExamples
          .map(
            (example) =>
              `- "${example.descripcionItem}"→${example.cuentaPuc},${formatImpuestosSummary(example.impuestos)}${
                example.confirmadaPorContador ? '(confirmado)' : ''
              }`,
          )
          .join('\n')}`
      : '';

  const userContent = `Proveedor: ${params.supplierName}
Ítems:
${itemsDescription}

Cuentas PUC:
${accountsCatalog}

IVA:
${taxesCatalog || 'ninguno'}

Retenciones:
${retentionsCatalog || 'ninguna'}${historicalExamplesSection}`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
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
