import type { OpenRouterMessage } from '../../openrouter/clients/openrouter-http.client';
import type { AccountCatalogItem } from '../../helpers/supplier-accounts-catalog.helper';

export interface PurchaseItemClassificationPromptItem {
  descripcion: string;
}

export interface PurchaseItemClassificationHistoricalExample {
  descripcionItem: string;
  cuentaPuc: string;
}

function extractJsonObject(rawText: string): string | null {
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');

  if (start === -1 || end === -1 || end < start) {
    return null;
  }

  return rawText.slice(start, end + 1);
}

/** Clampeado a [0, 100] en vez de descartar valores fuera de rango — un
 * modelo que responde 105 o -5 claramente quiso decir "muy alta"/"muy baja",
 * no un dato corrupto que deba tirarse. `undefined`/no numérico → null (no
 * se puede decidir Pendiente vs Requiere revisión sin esto). */
function toConfidenceOrNull(value: unknown): number | null {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.min(100, Math.max(0, Math.round(parsed)));
}

function itemsSection(items: PurchaseItemClassificationPromptItem[]): string {
  return items
    .map((item, index) => `${index + 1}. ${item.descripcion}`)
    .join('\n');
}

function historicalExamplesSection(
  examples: PurchaseItemClassificationHistoricalExample[] | undefined,
  label: string,
): string {
  if (!examples || examples.length === 0) {
    return '';
  }

  return `\n${label}:\n${examples
    .map((example) => `- "${example.descripcionItem}"→${example.cuentaPuc}`)
    .join('\n')}`;
}

// ---------------------------------------------------------------------------
// Paso 1: decidir SOLO el tipo de ítem (Cuenta vs Producto) — sin catálogos.
// Se llama únicamente cuando el historial del proveedor (campoVariabilidad.
// tipoItem, ver resolveSuggestedItemConfigFromConfiguration) no da un tipo
// fijo confiable Y la empresa tiene catálogo de productos SIIGO (si no lo
// tiene, el tipo es SIEMPRE "Account" y ni siquiera vale la pena llamar acá
// — ver SiigoAiAccountSuggestionService.classifyItemTypeAndAccount). Mandar
// ámbos catálogos completos solo para esta decisión de tipo desperdiciaba la
// mayoría de los tokens del prompt combinado original.
// ---------------------------------------------------------------------------

export interface ItemTypeClassificationPromptParams {
  supplierName: string;
  items: PurchaseItemClassificationPromptItem[];
}

const SYSTEM_PROMPT_ITEM_TYPE = `Clasificas UNA factura de compra colombiana para SIIGO (puede traer uno o varios ítems). Todavía NO elegís cuenta contable ni producto — solo decidís si el/los ítem(s) se deben registrar como "Cuenta" (un gasto/costo/servicio que se contabiliza directo a una cuenta PUC, ej. arriendo, servicios públicos, mantenimiento, honorarios, transporte) o como "Producto" (un bien físico que esta empresa maneja como inventario/mercancía, ej. materia prima, mercancía para reventa, insumos que se guardan en stock).

Esta empresa SÍ tiene catálogo de productos en SIIGO, así que "Producto" es una opción válida. Si hay varios ítems, elegí el tipo que mejor represente el conjunto (normalmente comparten el mismo concepto). Un servicio (algo que se consume, no se almacena) es SIEMPRE Cuenta, nunca Producto, aunque esté relacionado con un bien físico (ej. "Servicio de mantenimiento de aire acondicionado" es Cuenta, no Producto). Ante la duda entre un insumo consumible menor y un producto de inventario, preferí Cuenta.

Responde SOLO este JSON, sin texto extra: {"itemType":"Account"|"Product"}`;

export function buildItemTypeClassificationPrompt(
  params: ItemTypeClassificationPromptParams,
): OpenRouterMessage[] {
  const userContent = `Proveedor: ${params.supplierName}
Ítems:
${itemsSection(params.items)}`;

  return [
    { role: 'system', content: SYSTEM_PROMPT_ITEM_TYPE },
    { role: 'user', content: userContent },
  ];
}

export interface ParsedItemTypeClassification {
  itemType: 'Account' | 'Product' | null;
}

const EMPTY_ITEM_TYPE_RESULT: ParsedItemTypeClassification = { itemType: null };

export function parseItemTypeClassificationResponse(
  rawText: string,
): ParsedItemTypeClassification {
  const jsonSlice = extractJsonObject(rawText);

  if (!jsonSlice) {
    return EMPTY_ITEM_TYPE_RESULT;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    return EMPTY_ITEM_TYPE_RESULT;
  }

  if (!parsed || typeof parsed !== 'object') {
    return EMPTY_ITEM_TYPE_RESULT;
  }

  const record = parsed as Record<string, unknown>;
  const itemType =
    record.itemType === 'Account' || record.itemType === 'Product'
      ? record.itemType
      : null;

  return { itemType };
}

// ---------------------------------------------------------------------------
// Paso 2a: ya se sabe que el tipo es "Cuenta" — se manda SOLO el catálogo de
// cuentas (nunca el de productos) para elegir el código.
// ---------------------------------------------------------------------------

export interface AccountCodeClassificationPromptParams {
  supplierName: string;
  /** Nombre de la empresa que compra (nosotros) — contexto de a qué rubro
   * pertenece el gasto para esta empresa en particular. */
  ourCompanyName: string;
  items: PurchaseItemClassificationPromptItem[];
  /** Solo cuentas transaccionales — las de agrupación no son un destino
   * válido para contabilizar un movimiento. */
  accounts: AccountCatalogItem[];
  /** Últimas facturas de ESTE proveedor ya clasificadas como Cuenta — pocas
   * a propósito, cada una suma tokens en cada llamada. */
  historicalExamples?: PurchaseItemClassificationHistoricalExample[];
}

const SYSTEM_PROMPT_ACCOUNT_CODE = `Elegí UNA sola cuenta PUC de gasto/costo para la factura completa.

REGLAS DE PRIORIDAD:

1. Si existe un ejemplo previo del MISMO proveedor con un concepto igual o claramente equivalente, usá esa cuenta.
2. Si no existe, clasificá según el concepto REALMENTE indicado en los ítems.
3. No inventes ni completes significados que no estén respaldados por el texto. Una sigla, código o referencia desconocida no debe interpretarse como "leasing", "cuota", "equipo", "red", etc.
4. El nombre del proveedor puede dar contexto, pero NO determina por sí solo la cuenta.
5. Usá únicamente códigos que aparezcan literalmente en el catálogo.
6. Elegí siempre la categoría de gasto/costo más adecuada disponible, aunque el nombre de la cuenta no coincida literalmente con el texto.
7. Si la descripción es ambigua, elegí la opción con mayor respaldo objetivo y reducí la confianza. No inventes detalles para aumentar la confianza, pero siempre da una sugerencia.

IMPORTANTE:
No expliques el razonamiento, no describas alternativas y no inventes información.

confidence debe ser un entero de 0 a 100.

Respondé SOLO este JSON:
{"accountCode":string|null,"confidence":number}`;

export function buildAccountCodeClassificationPrompt(
  params: AccountCodeClassificationPromptParams,
): OpenRouterMessage[] {
  const accountsCatalog = params.accounts
    .map((account) => `${account.code} ${account.name}`)
    .join('\n');

  const userContent = `Empresa que compra: ${params.ourCompanyName}
Proveedor: ${params.supplierName}
Ítems:
${itemsSection(params.items)}

Cuentas PUC transaccionales:
${accountsCatalog}${historicalExamplesSection(params.historicalExamples, 'Ejemplos previos de este proveedor')}`;

  return [
    { role: 'system', content: SYSTEM_PROMPT_ACCOUNT_CODE },
    { role: 'user', content: userContent },
  ];
}

export interface ParsedAccountCodeClassification {
  accountCode: string | null;
  confidence: number | null;
}

const EMPTY_ACCOUNT_CODE_RESULT: ParsedAccountCodeClassification = {
  accountCode: null,
  confidence: null,
};

export function parseAccountCodeClassificationResponse(
  rawText: string,
): ParsedAccountCodeClassification {
  const jsonSlice = extractJsonObject(rawText);

  if (!jsonSlice) {
    return EMPTY_ACCOUNT_CODE_RESULT;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    return EMPTY_ACCOUNT_CODE_RESULT;
  }

  if (!parsed || typeof parsed !== 'object') {
    return EMPTY_ACCOUNT_CODE_RESULT;
  }

  const record = parsed as Record<string, unknown>;
  const accountCode =
    typeof record.accountCode === 'string' && record.accountCode.trim()
      ? record.accountCode.trim()
      : null;

  return { accountCode, confidence: toConfidenceOrNull(record.confidence) };
}

// ---------------------------------------------------------------------------
// Paso 2b: ya se sabe que el tipo es "Producto" — se manda SOLO el catálogo
// de productos (nunca el de cuentas) para elegir el código.
// ---------------------------------------------------------------------------

export interface ProductCodeClassificationPromptParams {
  supplierName: string;
  ourCompanyName: string;
  items: PurchaseItemClassificationPromptItem[];
  products: AccountCatalogItem[];
  /** Últimas facturas de ESTE proveedor ya clasificadas como Producto. */
  historicalExamples?: PurchaseItemClassificationHistoricalExample[];
}

const SYSTEM_PROMPT_PRODUCT_CODE = `Elegís el código de producto del catálogo de SIIGO que le corresponde a UNA factura de compra colombiana (puede traer uno o varios ítems, ya se determinó que el conjunto se contabiliza como Producto/inventario, no como Cuenta contable).

Tu respuesta es UN SOLO código para la factura completa, nunca uno por ítem — no existe un campo para eso. Si hay varios ítems, elegí el producto que mejor represente el conjunto; no dejes de responder ni expliques la duda, solo elegí la mejor opción única.

Reglas: si hay ejemplos previos de este proveedor, seguilos siempre. Usa SOLO códigos que estén LITERALMENTE en el catálogo dado, nunca inventes uno. A diferencia de una cuenta contable, un código de producto identifica un ítem específico del inventario — pero NO hace falta que el nombre del catálogo sea idéntico palabra por palabra a la descripción. Elegí el producto que más se le parezca (aunque esté abreviado, en otro orden, con alguna palabra de más/de menos, o con la talla/color/presentación escritos distinto) siempre que sea razonablemente claro que es el mismo artículo. Si no estás segura, elegí igual tu mejor opción y reportalo con confidence bajo en vez de no sugerir nada; productCode null solo es válido si genuinamente NINGÚN producto del catálogo se parece al ítem.

confidence: entero de 0 a 100, qué tan segura estás de la elección. 90-100 = hay un ejemplo previo de este proveedor con la misma descripción o casi idéntica. 60-89 = coincide bien pero sin ejemplo previo exacto. Por debajo de 50 = es una decisión forzada, sin señal fuerte. Sé honesta: es más útil reportar baja confianza en una elección dudosa que inflarla.

Responde SOLO este JSON, sin texto extra: {"productCode":string|null,"confidence":number}`;

export function buildProductCodeClassificationPrompt(
  params: ProductCodeClassificationPromptParams,
): OpenRouterMessage[] {
  const productsCatalog = params.products
    .map((product) => `${product.code} ${product.name}`)
    .join('\n');

  const userContent = `Empresa que compra: ${params.ourCompanyName}
Proveedor: ${params.supplierName}
Ítems:
${itemsSection(params.items)}

Catálogo de productos:
${productsCatalog}${historicalExamplesSection(params.historicalExamples, 'Ejemplos previos de este proveedor')}`;

  return [
    { role: 'system', content: SYSTEM_PROMPT_PRODUCT_CODE },
    { role: 'user', content: userContent },
  ];
}

export interface ParsedProductCodeClassification {
  productCode: string | null;
  confidence: number | null;
}

const EMPTY_PRODUCT_CODE_RESULT: ParsedProductCodeClassification = {
  productCode: null,
  confidence: null,
};

export function parseProductCodeClassificationResponse(
  rawText: string,
): ParsedProductCodeClassification {
  const jsonSlice = extractJsonObject(rawText);

  if (!jsonSlice) {
    return EMPTY_PRODUCT_CODE_RESULT;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    return EMPTY_PRODUCT_CODE_RESULT;
  }

  if (!parsed || typeof parsed !== 'object') {
    return EMPTY_PRODUCT_CODE_RESULT;
  }

  const record = parsed as Record<string, unknown>;
  const productCode =
    typeof record.productCode === 'string' && record.productCode.trim()
      ? record.productCode.trim()
      : null;

  return { productCode, confidence: toConfidenceOrNull(record.confidence) };
}
