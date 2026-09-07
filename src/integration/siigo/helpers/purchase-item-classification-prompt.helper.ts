import type { OpenRouterMessage } from '../../openrouter/clients/openrouter-http.client';
import type { AccountCatalogItem } from '../../helpers/supplier-accounts-catalog.helper';

export interface PurchaseItemClassificationPromptItem {
  descripcion: string;
}

export interface PurchaseItemClassificationHistoricalExample {
  descripcionItem: string;
  cuentaPuc: string;
}

export interface PurchaseItemClassificationPromptParams {
  supplierName: string;
  items: PurchaseItemClassificationPromptItem[];
  /** Solo cuentas transaccionales — las de agrupación no son un destino
   * válido para contabilizar un movimiento. */
  accounts: AccountCatalogItem[];
  /** Catálogo de productos SIIGO (GET /v1/products) — se usa solo cuando el
   * ítem clasifica como "Producto". */
  products?: AccountCatalogItem[];
  /** Últimas facturas de ESTE proveedor, como contexto — pocas a propósito,
   * cada una se manda en cada llamada y suma tokens por documento. */
  historicalExamples?: PurchaseItemClassificationHistoricalExample[];
}

export interface ParsedPurchaseItemClassification {
  itemType: 'Account' | 'Product' | null;
  accountCode: string | null;
  productCode: string | null;
}

// Respuesta mínima a propósito (sin IVA/retenciones/rationale/confidence):
// esto se llama solo cuando no hay una regla confiable ya calculada, así que
// tanto el prompt como la respuesta se mantienen lo más cortos posible.
//
// Dos variantes según si la empresa tiene o no catálogo de productos SIIGO
// sincronizado — caso real reportado (D1 SAS, sin productos en SIIGO): con
// el prompt genérico, la IA veía ítems físicos (snacks, bebidas) y los
// clasificaba como "Producto" por instinto semántico, inventando un
// productCode que en realidad era el código de una CUENTA de costo del
// catálogo (ej. "61350501 Comercio al por mayor y al por menor") — la
// sugerencia se perdía entera porque ese código nunca existe en un catálogo
// de productos vacío. Si la empresa no tiene productos, ni siquiera se le
// ofrece "Producto" como opción: así la IA razona directo en términos de
// cuenta contable desde el principio, en vez de necesitar reinterpretar una
// respuesta ya descartada.
const SYSTEM_PROMPT_WITH_PRODUCTS = `Clasificas UNA factura de compra colombiana para SIIGO (puede traer uno o varios ítems listados). En SIIGO se registra como "Cuenta" (gasto/costo, va a una cuenta PUC) o "Producto" (inventariable, va a un código del catálogo de productos). Decide cuál es, y según cuál sea, elige el código correspondiente del catálogo dado.

Tu respuesta es UN SOLO objeto para la factura completa, nunca uno por ítem — no existe un campo para eso. Si hay varios ítems, elegí la cuenta/producto que mejor represente el conjunto (normalmente comparten el mismo concepto de gasto); no dejes de responder ni expliques la duda, solo elegí la mejor opción única.

Reglas generales: si hay ejemplos previos de este proveedor, seguilos siempre. Usa SOLO códigos que estén LITERALMENTE en el catálogo dado, nunca inventes uno.

Cuenta: las cuentas PUC son categorías amplias de gasto/costo (ej. "Alimentos y bebidas", "Servicios", "Papelería"), no una descripción exacta del ítem — si el ítem es claramente un gasto/costo, elegí SIEMPRE la cuenta del catálogo que mejor encaje por tipo de gasto, aunque el nombre no coincida palabra por palabra. Dejá accountCode null solo si de verdad ninguna categoría del catálogo aplica.

Producto: a diferencia de Cuenta, un código de producto identifica un ítem específico del inventario — elegilo solo si el nombre del catálogo coincide claramente con la descripción del ítem. Si no hay una coincidencia clara, productCode null — acá sí es mejor vacío que mal puesto (un producto equivocado es un dato más específico y más difícil de detectar después).

Si es Cuenta, productCode siempre null; si es Producto, accountCode siempre null.

Responde SOLO este JSON, sin texto extra: {"itemType":"Account"|"Product"|null,"accountCode":string|null,"productCode":string|null}`;

const SYSTEM_PROMPT_ACCOUNTS_ONLY = `Clasificas UNA factura de compra colombiana para SIIGO (puede traer uno o varios ítems listados), eligiendo la cuenta PUC (gasto/costo) que le corresponde. Esta empresa NO tiene catálogo de productos en SIIGO, así que itemType es SIEMPRE "Account" — nunca "Product", aunque el ítem sea un bien físico (ej. alimentos, bebidas, insumos): sin catálogo de productos, siempre se contabiliza como cuenta de gasto o costo.

Tu respuesta es UN SOLO objeto para la factura completa, nunca uno por ítem — no existe un campo para eso. Si hay varios ítems, elegí la cuenta que mejor represente el conjunto (normalmente comparten el mismo concepto de gasto); no dejes de responder ni expliques la duda, solo elegí la mejor opción única.

Reglas: si hay ejemplos previos de este proveedor, seguilos siempre. Usa SOLO códigos que estén LITERALMENTE en el catálogo dado, nunca inventes uno. Las cuentas PUC son categorías amplias de gasto/costo (ej. "Alimentos y bebidas", "Comercio al por mayor y al por menor", "Servicios"), no una descripción exacta del ítem — elegí SIEMPRE la cuenta del catálogo que mejor encaje por tipo de gasto, aunque el nombre no coincida palabra por palabra. Dejá accountCode null solo si de verdad ninguna categoría del catálogo aplica.

Responde SOLO este JSON, sin texto extra: {"itemType":"Account"|null,"accountCode":string|null,"productCode":null}`;

export function buildPurchaseItemClassificationPrompt(
  params: PurchaseItemClassificationPromptParams,
): OpenRouterMessage[] {
  const hasProductsCatalog = Boolean(
    params.products && params.products.length > 0,
  );

  const itemsDescription = params.items
    .map((item, index) => `${index + 1}. ${item.descripcion}`)
    .join('\n');

  const accountsCatalog = params.accounts
    .map((account) => `${account.code} ${account.name}`)
    .join('\n');

  const productsCatalogSection = hasProductsCatalog
    ? `\n\nCatálogo de productos:\n${params
        .products!.map((product) => `${product.code} ${product.name}`)
        .join('\n')}`
    : '';

  const historicalExamplesSection =
    params.historicalExamples && params.historicalExamples.length > 0
      ? `\nEjemplos previos de este proveedor:\n${params.historicalExamples
          .map(
            (example) => `- "${example.descripcionItem}"→${example.cuentaPuc}`,
          )
          .join('\n')}`
      : '';

  const userContent = `Proveedor: ${params.supplierName}
Ítems:
${itemsDescription}

Cuentas PUC transaccionales:
${accountsCatalog}${productsCatalogSection}${historicalExamplesSection}`;

  return [
    {
      role: 'system',
      content: hasProductsCatalog
        ? SYSTEM_PROMPT_WITH_PRODUCTS
        : SYSTEM_PROMPT_ACCOUNTS_ONLY,
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

function toItemTypeOrNull(value: unknown): 'Account' | 'Product' | null {
  return value === 'Account' || value === 'Product' ? value : null;
}

const EMPTY_PARSED_RESULT: ParsedPurchaseItemClassification = {
  itemType: null,
  accountCode: null,
  productCode: null,
};

export function parsePurchaseItemClassificationResponse(
  rawText: string,
): ParsedPurchaseItemClassification {
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
  const itemType = toItemTypeOrNull(record.itemType);
  const accountCode =
    itemType === 'Account' &&
    typeof record.accountCode === 'string' &&
    record.accountCode.trim()
      ? record.accountCode.trim()
      : null;
  const productCode =
    itemType === 'Product' &&
    typeof record.productCode === 'string' &&
    record.productCode.trim()
      ? record.productCode.trim()
      : null;

  return { itemType, accountCode, productCode };
}
