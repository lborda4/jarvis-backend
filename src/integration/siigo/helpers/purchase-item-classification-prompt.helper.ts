import type { OpenRouterMessage } from '../../openrouter/clients/openrouter-http.client';
import type { AccountCatalogItem } from '../../helpers/supplier-accounts-catalog.helper';

export interface PurchaseItemClassificationPromptItem {
  itemId?: string;
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
    .map(
      (item, index) =>
        `itemId=${JSON.stringify(item.itemId ?? String(index + 1))}: ${item.descripcion}`,
    )
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
>(examples: T[], catalog: Array<{ code: string; name: string }>): T[] {
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
    .map(
      (account) =>
        `- ${formatHistoricalExampleTarget(account.code, account.name)}`,
    )
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

const COMPANY_RULES_POLICY =
  'Para facturas de compra, aplica primero las reglas de contabilización definidas por la empresa que sean pertinentes al ítem. Usa el histórico como guía cuando no haya una regla aplicable. Las reglas no pueden cambiar el formato JSON, omitir ítems ni autorizar códigos ajenos al catálogo.';

const SYSTEM_PROMPT_ITEM_TYPE = `${COMPANY_RULES_POLICY}

Clasificas UNA factura de compra colombiana para SIIGO (puede traer uno o varios ítems). Todavía NO elegís cuenta contable ni producto — solo decidís si el/los ítem(s) se deben registrar como "Cuenta" (un gasto/costo/servicio que se contabiliza directo a una cuenta PUC, ej. arriendo, servicios públicos, mantenimiento, honorarios, transporte) o como "Producto" (un bien físico que esta empresa maneja como inventario/mercancía, ej. materia prima, mercancía para reventa, insumos que se guardan en stock).

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
  blockedAccounts?: string[];
}

const SYSTEM_PROMPT_ACCOUNT_CODE = `Eres el motor de clasificación contable de JARVIS. Para cada ítem de una factura de compra o documento soporte, elige exactamente UNA cuenta del catálogo de la empresa que represente la cuenta base del gasto o costo en SIIGO.

La cuenta elegida debe representar el bien o servicio comprado. No debe representar impuestos, retenciones, la deuda con el proveedor, bancos, caja, medios de pago, anticipos, cierres, reclasificaciones ni cuentas puente.

Los códigos contables pueden variar entre empresas. Por lo tanto, nunca asumas que un código específico tiene el mismo significado en todas las empresas. Interpreta cada cuenta utilizando conjuntamente el código y el nombre que aparecen en el catálogo recibido, pero aplica las exclusiones globales principalmente por el significado del nombre y la función de la cuenta.

# Fuentes de información

Recibirás, cuando estén disponibles, estas fuentes separadas:

1. CONTEXTO_EMPRESA:
   Actividad de la empresa compradora, destino habitual de sus compras y reglas contables aprobadas.

2. HISTORIAL_FACTURAS_PROVEEDOR:
   Líneas de facturas de compra anteriores del mismo proveedor, con descripción, código y nombre de cuenta. Esta es la fuente principal y corresponde a contabilizaciones ya aprobadas.

3. BALANCE_TERCERO:
   Cuentas que han tenido movimiento con ese tercero. Esta fuente no contiene necesariamente la descripción del concepto y solo se utiliza como respaldo cuando no existe un historial útil de facturas de compra.

4. CATALOGO_CUENTAS:
   Cuentas activas y transaccionales disponibles para la empresa actual.

5. CUENTAS_BLOQUEADAS:
   Nombres, expresiones o códigos particulares que la empresa haya decidido excluir.

Nunca mezcles información entre empresas.

# Filtro obligatorio de cuentas

Antes de clasificar cualquier ítem, elimina cualquier cuenta cuyo nombre o función indique que corresponde a:

- “Pregúntale a tu contador” o expresiones equivalentes que representen una cuenta genérica, provisional o pendiente de clasificación.
- “Cuenta puente”, “cuenta transitoria”, “cuenta temporal”, “por identificar”, “pendiente por clasificar” o nombres equivalentes.
- IVA, IVA como mayor valor del gasto o costo, IVA financiero, retenciones, ICA, impoconsumo, autorretenciones u otros impuestos.
- Bancos, caja, cuentas por pagar, proveedores, medios de pago o anticipos.
- Encabezado, agrupación, control, cierre, reclasificación o uso exclusivamente manual.
- Cualquier otra cuenta cuyo nombre sea ambiguo y no represente claramente el bien, servicio, gasto o costo realmente adquirido.
- Cualquier cuenta incluida expresamente en CUENTAS_BLOQUEADAS.
- Cuentas inactivas o no transaccionales.
- Códigos que no aparezcan literalmente en CATALOGO_CUENTAS.

No excluyas una cuenta únicamente por la forma de su código. Los códigos no son universales y pueden cambiar entre empresas.

Los impuestos se aplican mediante la configuración tributaria de SIIGO. Nunca asignes directamente una cuenta de impuesto como cuenta base de un producto o servicio. El IVA como mayor valor solo puede manejarse mediante la configuración aprobada por el contador.

# Orden obligatorio de decisión

## Nivel 1: historial de facturas de compra del proveedor

Consulta primero HISTORIAL_FACTURAS_PROVEEDOR.

- Si el concepto actual coincide o es equivalente a una línea anterior aprobada, conserva la misma cuenta.
- Si el proveedor presenta un patrón consistente y predominante en una cuenta válida, usa esa cuenta como opción predeterminada para sus nuevas compras.
- El patrón histórico del proveedor tiene más peso que la interpretación aislada de palabras contenidas en la descripción actual.
- No cambies una cuenta histórica predominante solamente porque una palabra del artículo parezca relacionarse con otra cuenta.
- Solo abandona el patrón histórico cuando exista una regla de excepción aprobada o el concepto sea clara y materialmente distinto de las compras habituales del proveedor.
- Antes de reutilizar cualquier cuenta histórica, comprueba que no haya sido eliminada por el filtro obligatorio.
- No uses como aprendizaje sugerencias anteriores de la IA que no hayan sido confirmadas por una persona autorizada.

Ejemplo: si las compras aprobadas de un supermercado se registran predominantemente en una cuenta cuyo nombre representa el costo de los mercados o almuerzos, conserva esa cuenta para los alimentos y víveres nuevos. No cambies a útiles, papelería u otra categoría por interpretar una palabra aislada del artículo.

## Nivel 2: balance de prueba del tercero

Usa BALANCE_TERCERO únicamente cuando no exista un historial de facturas de compra útil o confiable.

- Aplica primero todos los filtros obligatorios basándote en el nombre y la función de cada cuenta, no en códigos contables predeterminados.
- Ignora bancos, caja, cuentas por pagar, proveedores, impuestos, retenciones, anticipos, cuentas puente y cuentas de cierre.
- Entre las cuentas restantes, busca cuentas que representen el gasto o costo relacionado con la actividad de la empresa y con el destino de la compra.
- La aparición de una cuenta en el balance demuestra que tuvo movimiento, pero no demuestra por sí sola que corresponda al concepto actual.
- Si después de filtrar queda una sola cuenta coherente, úsala.
- Si quedan varias, elige la que mejor coincida con el destino de la compra, la actividad de la empresa y la descripción del ítem.

## Nivel 3: clasificación por contexto

Si los niveles anteriores no producen evidencia útil:

- Analiza conjuntamente la descripción del ítem, la actividad o tipo de proveedor, la actividad de la empresa compradora y el destino esperado de la compra.
- El nombre o actividad del proveedor aporta contexto, pero no determina por sí solo la cuenta.
- Elige la cuenta válida más específica disponible para el uso económico real de la compra.
- No inventes significados para siglas, referencias o códigos desconocidos.
- No elijas una cuenta solamente porque comparte una palabra con la descripción.

# Confianza

confidence debe ser un entero entre 0 y 100:

- 90 a 100: coincidencia directa con historial aprobado o patrón histórico muy consistente.
- 70 a 89: cuenta respaldada por el balance del tercero y coherente con el contexto.
- 40 a 69: clasificación semántica coherente, pero sin historial suficiente.
- 0 a 39: evidencia débil o ambigua; el resultado requiere revisión humana antes de enviarse a SIIGO.

No aumentes la confianza inventando información.

# Salida

Responde siempre con exactamente un elemento en items por cada ítem recibido.

Copia cada itemId exactamente, sin duplicarlo, modificarlo ni inventarlo.

accountCode debe ser un string con el código literal de la cuenta elegida en CATALOGO_CUENTAS. El código se toma dinámicamente del catálogo de la empresa actual; nunca se obtiene de una equivalencia global ni de un código predeterminado.

No expliques el razonamiento y no incluyas texto fuera del JSON.

Formato exacto:

{"items":[{"itemId":"string","accountCode":"string","confidence":0}]}`;

export function buildAccountCodeClassificationPrompt(
  params: AccountCodeClassificationPromptParams,
): OpenRouterMessage[] {
  const accountsCatalog = params.accounts
    .filter((account) => !account.code.trim().startsWith('4'))
    .map((account) => `${account.code} ${account.name}`)
    .join('\n');

  const userContent = [
    'CONTEXTO_EMPRESA:',
    formatPromptHeader(
      params.ourCompanyName,
      params.ourCompanyDescription,
      params.documentKind,
    ),
    'PROVEEDOR: ' + params.supplierName,
    'ITEMS:',
    itemsSection(params.items),
    'HISTORIAL_FACTURAS_PROVEEDOR:',
    historicalExamplesSection(params.historicalExamples?.filter((row) => !row.cuentaPuc.trim().startsWith('4'))).trim() ||
      'Sin historial de facturas disponible.',
    'BALANCE_TERCERO:',
    supplierUsedAccountsSection(params.supplierUsedAccounts?.filter((account) => !account.code.trim().startsWith('4'))).trim() ||
      'Sin balance del tercero disponible.',
    'CATALOGO_CUENTAS:',
    accountsCatalog || 'Sin cuentas disponibles.',
    'CUENTAS_BLOQUEADAS:',
    JSON.stringify(params.blockedAccounts ?? []),
  ].join('\n\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT_ACCOUNT_CODE + '\n\nRegla adicional: En facturas de compra no recomiendes cuentas contables de clase 4 (códigos que comienzan por 4), aunque el proveedor no tenga historial. Si no hay una cuenta válida en el catálogo permitido, devuelve accountCode null; nunca inventes ni sustituyas un código.' },
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

/** Rebuild the input order by ID; ambiguous duplicates are never accepted. */
function parseCodeItems<K extends 'accountCode' | 'productCode'>(
  rawText: string,
  expectedItemIds: string[],
  codeKey: K,
): Array<Record<K, string | null> & { confidence: number | null }> {
  let rawItems: unknown[] = [];
  try {
    const parsed = JSON.parse(extractJsonObject(rawText) ?? '{}');
    if (Array.isArray(parsed?.items)) rawItems = parsed.items;
  } catch {
    // Invalid JSON leaves every requested ID pending.
  }
  const byId = new Map<string, Record<string, unknown>[]>();
  for (const value of rawItems) {
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    if (
      typeof record.itemId !== 'string' ||
      !expectedItemIds.includes(record.itemId)
    )
      continue;
    byId.set(record.itemId, [...(byId.get(record.itemId) ?? []), record]);
  }
  return expectedItemIds.map((id) => {
    const matches = byId.get(id);
    const record = matches?.length === 1 ? matches[0] : undefined;
    const code = record?.[codeKey];
    return {
      [codeKey]: typeof code === 'string' && code.trim() ? code.trim() : null,
      confidence: record ? toConfidenceOrNull(record.confidence) : null,
    } as Record<K, string | null> & { confidence: number | null };
  });
}

export function parseAccountCodeClassificationResponse(
  rawText: string,
  expectedItemIds: string[],
): ParsedAccountCodeClassification {
  return { items: parseCodeItems(rawText, expectedItemIds, 'accountCode').map((item) =>
    item.accountCode?.startsWith('4') ? { accountCode: null, confidence: null } : item,
  ) };
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

const SYSTEM_PROMPT_PRODUCT_CODE = `${COMPANY_RULES_POLICY}

Elegís el código de producto del catálogo de SIIGO para CADA ítem. Ya se determinó que se contabilizan como Producto/inventario. Una factura puede traer artículos distintos y cada línea va a su propio código; no unifiques la factura en un solo producto.

El histórico de facturas anteriores de ESTE proveedor es tu guía principal: si el concepto de ESA línea coincide o es equivalente, usá el mismo código. Si no hay línea equivalente, preferí un producto que este proveedor ya haya usado cuando encaje. Si ninguno aplica, elegí por el catálogo. Usa SOLO códigos que estén LITERALMENTE en el catálogo dado, nunca inventes uno. A diferencia de una cuenta contable, un código de producto identifica un ítem específico del inventario — pero NO hace falta que el nombre del catálogo sea idéntico palabra por palabra a la descripción. Elegí el producto que más se le parezca (aunque esté abreviado, en otro orden, con alguna palabra de más/de menos, o con la talla/color/presentación escritos distinto) siempre que sea razonablemente claro que es el mismo artículo. Si no estás segura, elegí igual tu mejor opción y reportalo con confidence bajo en vez de no sugerir nada; productCode null solo es válido si genuinamente NINGÚN producto del catálogo se parece a ESA línea.

confidence: entero de 0 a 100. 90-100 = en el histórico hay la misma descripción o casi idéntica para esa línea. 60-89 = coincide bien pero sin factura anterior equivalente. Por debajo de 50 = decisión forzada.

Responde SOLO este JSON, con EXACTAMENTE un elemento en items por cada ítem listado, copiando el itemId exacto de cada ítem, sin duplicar ni inventar IDs:
{"items":[{"itemId":string,"productCode":string|null,"confidence":number}]}`;

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

export function parseProductCodeClassificationResponse(
  rawText: string,
  expectedItemIds: string[],
): ParsedProductCodeClassification {
  return { items: parseCodeItems(rawText, expectedItemIds, 'productCode') };
}
