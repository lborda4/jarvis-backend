import type { OpenRouterMessage } from '../../openrouter/clients/openrouter-http.client';
import type { AccountCatalogItem } from '../../helpers/supplier-accounts-catalog.helper';

export interface PurchaseItemClassificationPromptItem {
  descripcion: string;
}

export interface PurchaseItemClassificationHistoricalExample {
  descripcionItem: string;
  cuentaPuc: string;
  /** Nombre real de `siigo_accounts` (o del catálogo de productos) para
   * ese código — la IA ve código + nombre, no solo el PUC/SKU. */
  cuentaNombre?: string | null;
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

export type ClassificationDocumentKind =
  | 'PURCHASE_INVOICE'
  | 'SUPPORT_DOCUMENT';

/** Nombre + rubro de la empresa que compra. El rubro (description) es lo
 * que le permite a la IA distinguir inventario vs gasto y elegir la cuenta
 * PUC correcta para ESTA empresa, no una genérica. */
export function formatCompanyContext(
  name?: string | null,
  description?: string | null,
): string {
  const trimmedName = name?.trim() || 'nuestra empresa';
  const trimmedDescription = description?.trim();

  if (!trimmedDescription) {
    return `Empresa que compra: ${trimmedName}`;
  }

  return `Empresa que compra: ${trimmedName}\nA qué se dedica: ${trimmedDescription}`;
}

export function formatPromptHeader(
  name?: string | null,
  description?: string | null,
  documentKind?: ClassificationDocumentKind | null,
): string {
  const companyContext = formatCompanyContext(name, description);

  if (documentKind === 'SUPPORT_DOCUMENT') {
    return `Documento: Documento soporte\n${companyContext}`;
  }

  if (documentKind === 'PURCHASE_INVOICE') {
    return `Documento: Factura de compra\n${companyContext}`;
  }

  return companyContext;
}

export function formatHistoricalExampleTarget(
  code: string,
  name?: string | null,
): string {
  const trimmedCode = code.trim();
  const trimmedName = name?.trim();

  if (trimmedName && trimmedName !== trimmedCode) {
    return `${trimmedCode} ${trimmedName}`;
  }

  return trimmedCode;
}

/** Completa `cuentaNombre` cruzando cada código contra el catálogo
 * (`siigo_accounts` o productos SIIGO). Si el código no está, se deja el
 * nombre que ya viniera (o null). */
export function attachCatalogNamesToHistoricalExamples<
  T extends {
    cuentaPuc: string;
    cuentaNombre?: string | null;
  },
>(
  examples: T[],
  catalog: Array<{ code: string; name: string }>,
): T[] {
  const nameByCode = new Map<string, string>();

  for (const item of catalog) {
    const code = item.code?.trim();
    const name = item.name?.trim();

    if (code && name && !nameByCode.has(code)) {
      nameByCode.set(code, name);
    }
  }

  return examples.map((example) => {
    const code = example.cuentaPuc.trim();

    return {
      ...example,
      cuentaNombre: nameByCode.get(code) || example.cuentaNombre || null,
    };
  });
}

const HISTORICAL_INVOICES_LABEL =
  'Histórico de facturas anteriores de este proveedor (concepto + código y nombre de cuenta)';

function historicalExamplesSection(
  examples: PurchaseItemClassificationHistoricalExample[] | undefined,
  label: string = HISTORICAL_INVOICES_LABEL,
  targetLabel = 'Cuenta',
): string {
  if (!examples || examples.length === 0) {
    return '';
  }

  return `\n${label}:\n${examples
    .map(
      (example) =>
        `- Concepto: "${example.descripcionItem}" | ${targetLabel}: ${formatHistoricalExampleTarget(example.cuentaPuc, example.cuentaNombre)}`,
    )
    .join('\n')}`;
}

function supplierUsedAccountsSection(
  accounts: Array<{ code: string; name?: string | null }> | undefined,
): string {
  if (!accounts || accounts.length === 0) {
    return '';
  }

  return `\nCuentas que este proveedor ya usó (balance general; sin descripción de concepto):\n${accounts
    .map((account) => `- ${formatHistoricalExampleTarget(account.code, account.name)}`)
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

export interface ItemTypeClassificationHistoricalExample {
  descripcionItem: string;
  itemType: 'Account' | 'Product';
}

export interface ItemTypeClassificationPromptParams {
  supplierName: string;
  ourCompanyName?: string;
  ourCompanyDescription?: string | null;
  documentKind?: ClassificationDocumentKind | null;
  items: PurchaseItemClassificationPromptItem[];
  historicalExamples?: ItemTypeClassificationHistoricalExample[];
}

const SYSTEM_PROMPT_ITEM_TYPE = `Clasificas UNA factura de compra colombiana para SIIGO (puede traer uno o varios ítems). Todavía NO elegís cuenta contable ni producto — solo decidís si el/los ítem(s) se deben registrar como "Cuenta" (un gasto/costo/servicio que se contabiliza directo a una cuenta PUC, ej. arriendo, servicios públicos, mantenimiento, honorarios, transporte) o como "Producto" (un bien físico que esta empresa maneja como inventario/mercancía, ej. materia prima, mercancía para reventa, insumos que se guardan en stock).

Esta empresa SÍ tiene catálogo de productos en SIIGO, así que "Producto" es una opción válida. Tené en cuenta a qué se dedica la empresa que compra: un mismo ítem puede ser inventario para una comercializadora y gasto para una de servicios. Si hay varios ítems, elegí el tipo que mejor represente el conjunto (normalmente comparten el mismo concepto). Un servicio (algo que se consume, no se almacena) es SIEMPRE Cuenta, nunca Producto, aunque esté relacionado con un bien físico (ej. "Servicio de mantenimiento de aire acondicionado" es Cuenta, no Producto). Ante la duda entre un insumo consumible menor y un producto de inventario, preferí Cuenta.

Si hay histórico de facturas anteriores de ESTE proveedor, usalo como guía principal para el tipo: repetí cómo YA se contabilizó a este proveedor, salvo que la línea actual sea claramente lo contrario.

Responde SOLO este JSON, sin texto extra: {"itemType":"Account"|"Product"}`;

function itemTypeHistorySection(
  examples: ItemTypeClassificationHistoricalExample[] | undefined,
): string {
  if (!examples || examples.length === 0) {
    return '';
  }

  return `\nHistórico de facturas anteriores de este proveedor (cómo YA se contabilizó):\n${examples
    .map(
      (example) =>
        `- "${example.descripcionItem}"→${example.itemType === 'Product' ? 'Producto' : 'Cuenta'}`,
    )
    .join('\n')}`;
}

export function buildItemTypeClassificationPrompt(
  params: ItemTypeClassificationPromptParams,
): OpenRouterMessage[] {
  const userContent = `${formatPromptHeader(params.ourCompanyName, params.ourCompanyDescription, params.documentKind)}
Proveedor: ${params.supplierName}
Ítems:
${itemsSection(params.items)}${itemTypeHistorySection(params.historicalExamples)}`;

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
  ourCompanyDescription?: string | null;
  documentKind?: ClassificationDocumentKind | null;
  items: PurchaseItemClassificationPromptItem[];
  /** Solo cuentas transaccionales — las de agrupación no son un destino
   * válido para contabilizar un movimiento. */
  accounts: AccountCatalogItem[];
  /** Líneas de facturas anteriores de ESTE proveedor (guía principal). */
  historicalExamples?: PurchaseItemClassificationHistoricalExample[];
  /** Cuentas distintas con las que YA se contabilizó a este proveedor. */
  supplierUsedAccounts?: Array<{ code: string; name?: string | null }>;
}

const SYSTEM_PROMPT_ACCOUNT_CODE = `Elegí UNA cuenta PUC de gasto/costo para CADA ítem de una factura de compra o un documento soporte. El documento puede traer conceptos distintos (papelería, aseo, mantenimiento) y cada línea va a su propia cuenta; no unifiques el documento en un solo código.

Tené en cuenta a qué se dedica la empresa que compra: un mismo ítem puede ser un gasto distinto según el rubro (inventario, insumo, servicio, costo de venta). Usá el campo "A qué se dedica" para elegir la cuenta de ESTA empresa, no una genérica.

REGLAS DE PRIORIDAD:

1. El histórico de facturas anteriores de ESTE proveedor es tu guía principal. Esas líneas YA se contabilizaron (cuenta PUC + nombre). Si el concepto de ESA línea actual coincide o es equivalente, usá ESA misma cuenta.
2. Si no hay línea equivalente, preferí una de las cuentas que este proveedor ya usó cuando encaje con el tipo de gasto de esa línea.
3. Si ninguna cuenta ya usada aplica, clasificá según el concepto REALMENTE indicado en esa línea usando el catálogo.
4. No inventes ni completes significados que no estén respaldados por el texto. Una sigla, código o referencia desconocida no debe interpretarse como "leasing", "cuota", "equipo", "red", etc.
5. El nombre del proveedor puede dar contexto, pero NO determina por sí solo la cuenta.
6. Usá únicamente códigos que aparezcan literalmente en el catálogo.
7. Elegí siempre la categoría de gasto/costo más adecuada disponible, aunque el nombre de la cuenta no coincida literalmente con el texto.
8. Si la descripción es ambigua, elegí la opción con mayor respaldo objetivo y reducí la confianza. No inventes detalles para aumentar la confianza.
9. OBLIGATORIO: tenés que responder SIEMPRE. accountCode es un string obligatorio de un código del catálogo. PROHIBIDO devolver null, "null", vacío u omitir un ítem. Si no estás segura, igual elegí la mejor cuenta (priorizá las que este proveedor ya usó) y bajá confidence.

IMPORTANTE:
No expliques el razonamiento, no describas alternativas y no inventes información. No te abstengas: siempre hay una cuenta que responder.

confidence debe ser un entero de 0 a 100.

Respondé SOLO este JSON, con EXACTAMENTE un elemento en items por cada ítem listado, en el mismo orden:
{"items":[{"accountCode":string,"confidence":number}]}`;

export function buildAccountCodeClassificationPrompt(
  params: AccountCodeClassificationPromptParams,
): OpenRouterMessage[] {
  const accountsCatalog = params.accounts
    .map((account) => `${account.code} ${account.name}`)
    .join('\n');

  const userContent = `${formatPromptHeader(params.ourCompanyName, params.ourCompanyDescription, params.documentKind)}
Proveedor: ${params.supplierName}
Ítems:
${itemsSection(params.items)}

Cuentas PUC transaccionales:
${accountsCatalog}${supplierUsedAccountsSection(params.supplierUsedAccounts)}${historicalExamplesSection(params.historicalExamples)}`;

  return [
    { role: 'system', content: SYSTEM_PROMPT_ACCOUNT_CODE },
    { role: 'user', content: userContent },
  ];
}

export interface ParsedAccountCodeItem {
  accountCode: string | null;
  confidence: number | null;
}

export interface ParsedAccountCodeClassification {
  items: ParsedAccountCodeItem[];
}

function emptyAccountItems(count: number): ParsedAccountCodeItem[] {
  return Array.from({ length: Math.max(count, 0) }, () => ({
    accountCode: null,
    confidence: null,
  }));
}

function parseAccountCodeItem(value: unknown): ParsedAccountCodeItem {
  if (!value || typeof value !== 'object') {
    return { accountCode: null, confidence: null };
  }

  const record = value as Record<string, unknown>;
  const accountCode =
    typeof record.accountCode === 'string' && record.accountCode.trim()
      ? record.accountCode.trim()
      : null;

  return { accountCode, confidence: toConfidenceOrNull(record.confidence) };
}

export function parseAccountCodeClassificationResponse(
  rawText: string,
  expectedItemCount = 1,
): ParsedAccountCodeClassification {
  const jsonSlice = extractJsonObject(rawText);

  if (!jsonSlice) {
    return { items: emptyAccountItems(expectedItemCount) };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    return { items: emptyAccountItems(expectedItemCount) };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { items: emptyAccountItems(expectedItemCount) };
  }

  const record = parsed as Record<string, unknown>;
  const rawItems = Array.isArray(record.items)
    ? record.items.map((item) => parseAccountCodeItem(item))
    : [parseAccountCodeItem(record)];

  const items = rawItems.slice(0, expectedItemCount);

  while (items.length < expectedItemCount) {
    items.push({ accountCode: null, confidence: null });
  }

  return { items };
}

// ---------------------------------------------------------------------------
// Paso 2b: ya se sabe que el tipo es "Producto" — se manda SOLO el catálogo
// de productos (nunca el de cuentas) para elegir el código.
// ---------------------------------------------------------------------------

export interface ProductCodeClassificationPromptParams {
  supplierName: string;
  ourCompanyName: string;
  ourCompanyDescription?: string | null;
  documentKind?: ClassificationDocumentKind | null;
  items: PurchaseItemClassificationPromptItem[];
  products: AccountCatalogItem[];
  /** Líneas de facturas anteriores de ESTE proveedor (guía principal). */
  historicalExamples?: PurchaseItemClassificationHistoricalExample[];
  /** Productos distintos con los que YA se contabilizó a este proveedor. */
  supplierUsedAccounts?: Array<{ code: string; name?: string | null }>;
}

const SYSTEM_PROMPT_PRODUCT_CODE = `Elegís el código de producto del catálogo de SIIGO para CADA ítem. Ya se determinó que se contabilizan como Producto/inventario. Una factura puede traer artículos distintos y cada línea va a su propio código; no unifiques la factura en un solo producto.

El histórico de facturas anteriores de ESTE proveedor es tu guía principal: si el concepto de ESA línea coincide o es equivalente, usá el mismo código. Si no hay línea equivalente, preferí un producto que este proveedor ya haya usado cuando encaje. Si ninguno aplica, elegí por el catálogo. Usa SOLO códigos que estén LITERALMENTE en el catálogo dado, nunca inventes uno. A diferencia de una cuenta contable, un código de producto identifica un ítem específico del inventario — pero NO hace falta que el nombre del catálogo sea idéntico palabra por palabra a la descripción. Elegí el producto que más se le parezca (aunque esté abreviado, en otro orden, con alguna palabra de más/de menos, o con la talla/color/presentación escritos distinto) siempre que sea razonablemente claro que es el mismo artículo. Si no estás segura, elegí igual tu mejor opción y reportalo con confidence bajo en vez de no sugerir nada; productCode null solo es válido si genuinamente NINGÚN producto del catálogo se parece a ESA línea.

confidence: entero de 0 a 100. 90-100 = en el histórico hay la misma descripción o casi idéntica para esa línea. 60-89 = coincide bien pero sin factura anterior equivalente. Por debajo de 50 = decisión forzada.

Responde SOLO este JSON, con EXACTAMENTE un elemento en items por cada ítem listado, en el mismo orden:
{"items":[{"productCode":string|null,"confidence":number}]}`;

export function buildProductCodeClassificationPrompt(
  params: ProductCodeClassificationPromptParams,
): OpenRouterMessage[] {
  const productsCatalog = params.products
    .map((product) => `${product.code} ${product.name}`)
    .join('\n');

  const userContent = `${formatPromptHeader(params.ourCompanyName, params.ourCompanyDescription, params.documentKind)}
Proveedor: ${params.supplierName}
Ítems:
${itemsSection(params.items)}

Catálogo de productos:
${productsCatalog}${historicalExamplesSection(
  params.historicalExamples,
  'Histórico de facturas anteriores de este proveedor (concepto + código y nombre de producto)',
  'Producto',
)}`;

  return [
    { role: 'system', content: SYSTEM_PROMPT_PRODUCT_CODE },
    { role: 'user', content: userContent },
  ];
}

export interface ParsedProductCodeItem {
  productCode: string | null;
  confidence: number | null;
}

export interface ParsedProductCodeClassification {
  items: ParsedProductCodeItem[];
}

function emptyProductItems(count: number): ParsedProductCodeItem[] {
  return Array.from({ length: Math.max(count, 0) }, () => ({
    productCode: null,
    confidence: null,
  }));
}

function parseProductCodeItem(value: unknown): ParsedProductCodeItem {
  if (!value || typeof value !== 'object') {
    return { productCode: null, confidence: null };
  }

  const record = value as Record<string, unknown>;
  const productCode =
    typeof record.productCode === 'string' && record.productCode.trim()
      ? record.productCode.trim()
      : null;

  return { productCode, confidence: toConfidenceOrNull(record.confidence) };
}

export function parseProductCodeClassificationResponse(
  rawText: string,
  expectedItemCount = 1,
): ParsedProductCodeClassification {
  const jsonSlice = extractJsonObject(rawText);

  if (!jsonSlice) {
    return { items: emptyProductItems(expectedItemCount) };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    return { items: emptyProductItems(expectedItemCount) };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { items: emptyProductItems(expectedItemCount) };
  }

  const record = parsed as Record<string, unknown>;
  const rawItems = Array.isArray(record.items)
    ? record.items.map((item) => parseProductCodeItem(item))
    : [parseProductCodeItem(record)];

  const items = rawItems.slice(0, expectedItemCount);

  while (items.length < expectedItemCount) {
    items.push({ productCode: null, confidence: null });
  }

  return { items };
}
