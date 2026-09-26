import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ElectronicDocumentService } from '../../electronic-document/electronic-document.service';
import { ElectronicDocumentType } from '../../electronic-document/enums/electronic-document-type.enum';
import { CompaniesRepository } from '../../company/repositories/companies.repository';
import { HistorialFacturasRepository } from '../repositories/historial-facturas.repository';
import { HistorialFacturaFuente } from '../enums/historial-factura-fuente.enum';
import { HistorialFacturaTipo } from '../enums/historial-factura-tipo.enum';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { SiigoAccountsRepository } from '../repositories/siigo-accounts.repository';
import { SupplierConfigurationsRepository } from '../repositories/supplier-configurations.repository';
import {
  OpenRouterHttpClient,
  type OpenRouterMessage,
} from '../openrouter/clients/openrouter-http.client';
import { isAllowedAccountCode } from '../helpers/supplier-accounts-catalog.helper';
import { applyItemClassificationToPayload } from '../../electronic-document/helpers/electronic-document-account-mapping.helper';
import { resolveSuggestedItemConfigFromConfiguration } from '../helpers/supplier-preference.helper';
import {
  buildPurchaseClassificationPrompt,
  parsePurchaseClassificationResponse,
} from './helpers/purchase-classification-prompt.helper';
import {
  attachCatalogNamesToHistoricalExamples,
  buildAccountCodeClassificationPrompt,
  buildItemTypeClassificationPrompt,
  buildProductCodeClassificationPrompt,
  parseAccountCodeClassificationResponse,
  parseItemTypeClassificationResponse,
  parseProductCodeClassificationResponse,
  type PurchaseItemClassificationPromptItem,
} from './helpers/purchase-item-classification-prompt.helper';
import { resolveAccountSuggestionConfidence } from './helpers/account-suggestion-confidence.helper';
import {
  HISTORICAL_EXAMPLE_INVOICE_LIMIT,
  selectHistoricalExamplesForPrompt,
  splitSupplierHistory,
  uniqueSupplierUsedAccounts,
} from './helpers/select-historical-examples.helper';
import { SuggestPurchaseItemClassificationResponseDto } from './dto/suggest-purchase-item-classification.dto';
import {
  getSiigoIntegration,
  normalizeSupplierDocument,
} from './helpers/siigo-context.helper';
import { SiigoAccountsCatalogService } from './siigo-accounts-catalog.service';
import { SiigoProductsCatalogService } from './siigo-products-catalog.service';
import { SiigoProductCatalogItemDto } from './dto/list-siigo-products.dto';
import { SiigoTaxesCatalogService } from './siigo-taxes-catalog.service';

// Respuesta angosta (itemType + accountCode nada más): alcanza con pocos
// tokens de salida — probado en vivo con openai/gpt-4o-mini en ~15-20 tokens
// reales de respuesta.
const ITEM_CLASSIFICATION_MAX_TOKENS = 10000;
// Keep each code-classification request small, including retry requests.
const ITEM_CLASSIFICATION_BATCH_SIZE = 15;
// Paso 1 (decidir SOLO Cuenta vs Producto, sin catálogos) responde un JSON
// mínimo — un tope bajo alcanza de sobra y evita gastar de más si el modelo
// se explaya con texto extra.
const ITEM_TYPE_CLASSIFICATION_MAX_TOKENS = 300;
// Empresas con catálogo de productos grande (ej. una textilera con miles de
// referencias de tela) hacen que mandar el catálogo COMPLETO en cada
// clasificación explote en tokens — caso real reportado: 3139 productos ≈
// 49.000 tokens, OpenRouter rechazó la llamada entera con 402 "prompt
// tokens limit exceeded" y la clasificación nunca llegó a correr. Por
// encima de este tope, se filtra a solo los productos cuyo nombre comparte
// alguna palabra con la descripción de los ítems a clasificar — si ninguno
// matchea (caso real: proveedor de snacks para una textilera, ningún
// producto de tela va a compartir palabras con "GALLETA"), el catálogo
// efectivo queda vacío y el prompt cae al modo "solo cuenta" (ver
// buildPurchaseItemClassificationPrompt), que es lo correcto en ese caso.
const MAX_PRODUCTS_FOR_CLASSIFICATION_PROMPT = 80;
/** Palabras de 3 letras o menos (conectores, unidades) no son lo bastante
 * discriminantes para decidir si un producto es relevante. */
const MIN_PRODUCT_KEYWORD_LENGTH = 4;

const EMPTY_SUGGESTION: SuggestPurchaseItemClassificationResponseDto = {
  accountCode: null,
  accountName: null,
  taxId: null,
  taxName: null,
  taxPercentage: null,
  retentionSuggestions: [],
};

export interface ClassifiedPurchaseItem {
  accountCode: string | null;
  accountName: string | null;
  productCode: string | null;
  productName: string | null;
  confidence: number | null;
}

export interface ItemTypeAndAccountClassification {
  itemType: 'Account' | 'Product' | null;
  accountCode: string | null;
  accountName: string | null;
  productCode: string | null;
  productName: string | null;
  /** 0-100 — mínimo de las líneas. null cuando no hubo clasificación. */
  confidence: number | null;
  items: ClassifiedPurchaseItem[];
}

const EMPTY_ITEM_CLASSIFICATION: ItemTypeAndAccountClassification = {
  itemType: null,
  accountCode: null,
  accountName: null,
  productCode: null,
  productName: null,
  confidence: null,
  items: [],
};

function pickUnanimous<T extends string>(
  values: Array<T | null | undefined>,
): T | null {
  const present = values.filter((value): value is T => Boolean(value));

  if (present.length === 0 || present.length !== values.length) {
    return null;
  }

  return present.every((value) => value === present[0]) ? present[0] : null;
}

function pickMinimumConfidence(
  values: Array<number | null | undefined>,
): number | null {
  const present = values.filter(
    (value): value is number => value != null && Number.isFinite(value),
  );

  if (present.length === 0) {
    return null;
  }

  return Math.min(...present);
}

function extractKeywords(descriptions: string[]): string[] {
  return [
    ...new Set(
      descriptions
        .flatMap((descripcion) =>
          descripcion.toLowerCase().split(/[^a-z0-9áéíóúñ]+/i),
        )
        .filter((word) => word.length >= MIN_PRODUCT_KEYWORD_LENGTH),
    ),
  ];
}

/**
 * Recorta el catálogo de productos a uno manejable en tokens cuando la
 * empresa tiene demasiados (ver MAX_PRODUCTS_FOR_CLASSIFICATION_PROMPT) —
 * se queda solo con los que comparten alguna palabra con la descripción de
 * los ítems a clasificar. Un catálogo chico pasa intacto; uno grande sin
 * ningún match relevante queda vacío a propósito (no se manda "los primeros
 * N" arbitrarios, que no aportarían nada útil).
 */
export function selectProductsForClassificationPrompt(
  itemDescriptions: string[],
  productsCatalog: SiigoProductCatalogItemDto[],
): SiigoProductCatalogItemDto[] {
  if (productsCatalog.length <= MAX_PRODUCTS_FOR_CLASSIFICATION_PROMPT) {
    return productsCatalog;
  }

  const keywords = extractKeywords(itemDescriptions);

  if (keywords.length === 0) {
    return [];
  }

  const matches = productsCatalog.filter((product) => {
    const name = product.name.toLowerCase();
    return keywords.some((keyword) => name.includes(keyword));
  });

  return matches.slice(0, MAX_PRODUCTS_FOR_CLASSIFICATION_PROMPT);
}

@Injectable()
export class SiigoAiAccountSuggestionService {
  private readonly logger = new Logger(SiigoAiAccountSuggestionService.name);

  constructor(
    private readonly openRouterHttpClient: OpenRouterHttpClient,
    private readonly electronicDocumentService: ElectronicDocumentService,
    private readonly siigoAccountsCatalogService: SiigoAccountsCatalogService,
    private readonly siigoProductsCatalogService: SiigoProductsCatalogService,
    private readonly siigoTaxesCatalogService: SiigoTaxesCatalogService,
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly historialFacturasRepository: HistorialFacturasRepository,
    private readonly siigoAccountsRepository: SiigoAccountsRepository,
    private readonly supplierConfigurationsRepository: SupplierConfigurationsRepository,
    private readonly companiesRepository: CompaniesRepository,
  ) {}

  /** Endpoint manual: misma cuenta/producto que el import automático, más
   * IVA y retenciones en una llamada aparte. */
  async suggestForDocument(
    documentId: string,
    companyId: string,
  ): Promise<SuggestPurchaseItemClassificationResponseDto> {
    if (!this.openRouterHttpClient.isConfigured()) {
      throw new BadRequestException(
        'La integración con IA no está configurada (falta OPENROUTER_API_KEY).',
      );
    }

    const document = await this.electronicDocumentService.requireById(
      documentId,
      companyId,
    );

    const classification = await this.classifyItemTypeAndAccount(
      documentId,
      companyId,
    );
    const firstAccount = classification.items.find((item) => item.accountCode);

    const freshDocument = await this.electronicDocumentService.requireById(
      documentId,
      companyId,
    );

    await this.electronicDocumentService.updatePayload(
      documentId,
      applyItemClassificationToPayload(freshDocument.payload, classification),
      companyId,
    );

    const [allTaxes, integration, company] = await Promise.all([
      this.siigoTaxesCatalogService.listTaxes({}, companyId),
      getSiigoIntegration(this.integrationsRepository, companyId),
      this.companiesRepository.findById(companyId),
    ]);

    const activeIvaTaxes = allTaxes.filter(
      (tax) => tax.active && tax.type?.trim().toLowerCase() === 'iva',
    );
    const activeRetentionTaxes = allTaxes.filter(
      (tax) => tax.active && tax.type?.trim().toLowerCase() !== 'iva',
    );

    const supplierNit = normalizeSupplierDocument(
      document.payload.supplier.documentNumber ?? '',
    );
    const itemDescriptions = document.payload.items.map(
      (item) => item.descripcion,
    );
    const historicalPool = supplierNit
      ? await this.historialFacturasRepository.findRecentInvoicesBySupplier(
          companyId,
          integration.id,
          supplierNit,
          HISTORICAL_EXAMPLE_INVOICE_LIMIT,
        )
      : [];
    const { invoiceRows: taxInvoiceRows } =
      splitSupplierHistory(historicalPool);
    const historicalRows = selectHistoricalExamplesForPrompt(
      itemDescriptions,
      taxInvoiceRows,
    );

    const prompt = buildPurchaseClassificationPrompt({
      supplierName: document.payload.supplier.name || 'Desconocido',
      ourCompanyName: company?.name || 'nuestra empresa',
      ourCompanyDescription: company?.description?.trim() || null,
      documentKind:
        document.electronicDocumentType ===
        ElectronicDocumentType.SUPPORT_DOCUMENT
          ? 'SUPPORT_DOCUMENT'
          : 'PURCHASE_INVOICE',
      items: document.payload.items.map((item) => ({
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        valorUnitario: item.valorUnitario,
      })),
      accounts: [],
      taxes: activeIvaTaxes,
      retentionTaxes: activeRetentionTaxes,
      includeAccount: false,
      historicalExamples: attachCatalogNamesToHistoricalExamples(
        historicalRows.map((row) => ({
          descripcionItem: row.descripcionItem,
          cuentaPuc: row.cuentaPuc,
          impuestos: row.impuestos,
          confirmadaPorContador:
            row.fuente === HistorialFacturaFuente.CORREGIDO_CONTADOR,
        })),
        [],
      ),
    });

    console.log(
      `[AI-CLASSIFY] [documentId=${documentId}] IVA/retenciones ANTES de OpenRouter — historicoLineas=${historicalRows.length}`,
    );

    const { content: rawText } =
      await this.openRouterHttpClient.createChatCompletion(prompt, {
        context: {
          companyId,
          documentId,
          purpose: 'purchase-tax-classification',
        },
      });
    const parsed = parsePurchaseClassificationResponse(rawText);

    const matchedTax =
      parsed.taxId != null
        ? (activeIvaTaxes.find((tax) => tax.id === parsed.taxId) ?? null)
        : null;
    const matchedRetentions = parsed.retentionIds
      .map((id) => activeRetentionTaxes.find((tax) => tax.id === id))
      .filter((tax): tax is NonNullable<typeof tax> => Boolean(tax));

    if (parsed.taxId != null && !matchedTax) {
      this.logger.warn(
        `[documentId=${documentId}] IA sugirió taxId=${parsed.taxId} que no existe en el catálogo; se descarta.`,
      );
    }

    if (matchedRetentions.length !== parsed.retentionIds.length) {
      this.logger.warn(
        `[documentId=${documentId}] IA sugirió retentionIds=[${parsed.retentionIds.join(',')}] con alguno fuera del catálogo; se descartan los que no existen.`,
      );
    }

    return {
      ...EMPTY_SUGGESTION,
      accountCode:
        classification.accountCode ?? firstAccount?.accountCode ?? null,
      accountName:
        classification.accountName ?? firstAccount?.accountName ?? null,
      taxId: matchedTax?.id ?? null,
      taxName: matchedTax?.name ?? null,
      taxPercentage: matchedTax?.percentage ?? null,
      retentionSuggestions: matchedRetentions.map((tax) => ({
        id: tax.id,
        name: tax.name,
        type: tax.type,
        percentage: tax.percentage,
      })),
    };
  }

  /**
   * Misma clasificación de tipo + código por ítem que usa el import
   * automático. `suggestForDocument` la reutiliza para la cuenta/producto
   * y pide IVA/retenciones en una llamada aparte.
   *
   * Se separa en DOS llamadas a la IA en vez de una sola con ambos catálogos
   * completos (diseño anterior) — caso real reportado: mandar TODAS las
   * cuentas Y TODOS los productos en un solo prompt saturaba el límite de
   * tokens de la empresa, dejando poco espacio para que el modelo razone.
   * Paso 1 decide SOLO el tipo (sin catálogos, prompt mínimo) — y ni
   * siquiera llama a la IA si ya se puede resolver desde la base de datos
   * (ver resolveSuggestedItemConfigFromConfiguration/campoVariabilidad.
   * tipoItem, calculado por el sync de historial de compras). Paso 2 manda
   * SOLO el catálogo que corresponde según el tipo ya decidido.
   */
  async classifyItemTypeAndAccount(
    documentId: string,
    companyId: string,
    onItemTypeResolved?: (
      itemType: 'Account' | 'Product',
    ) => Promise<void> | void,
  ): Promise<ItemTypeAndAccountClassification> {
    if (!this.openRouterHttpClient.isConfigured()) {
      console.log(
        `[AI-CLASSIFY] [documentId=${documentId}] Omitido: OpenRouter no está configurado (falta OPENROUTER_API_KEY).`,
      );
      return EMPTY_ITEM_CLASSIFICATION;
    }

    const document = await this.electronicDocumentService.requireById(
      documentId,
      companyId,
    );
    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );
    // Documento soporte SIEMPRE se contabiliza a una cuenta (ver
    // buildSiigoSupportDocumentRequest.ts: items[].type es 'Account' fijo,
    // nunca 'Product') — a diferencia de Factura de compra, no tiene sentido
    // ofrecerle "Producto" a la IA acá ni siquiera en el paso 1: se fuerza
    // "Account" directo, sin gastar esa llamada.
    const isSupportDocument =
      document.electronicDocumentType ===
      ElectronicDocumentType.SUPPORT_DOCUMENT;

    const [allTransactionalAccounts, productsCatalog, company] =
      await Promise.all([
        this.siigoAccountsRepository.findTransactionalByCompanyAndIntegration(
          companyId,
          integration.id,
        ),
        isSupportDocument
          ? Promise.resolve([])
          : this.siigoProductsCatalogService
              .listProducts(companyId)
              .catch((): SiigoProductCatalogItemDto[] => []),
        this.companiesRepository.findById(companyId),
      ]);

    // findTransactionalByCompanyAndIntegration no filtra por clase — trae
    // TODAS las cuentas transaccionales (activo, pasivo, patrimonio, ingreso,
    // gasto, costo). Un ítem de factura de COMPRA solo puede ir a gasto/costo
    // (clase 5/6/7, mismo criterio que resolveSuggestedAccountFromPreference
    // e isAllowedAccountCode) — sin este filtro la IA queda libre de elegir
    // (y de hecho eligió, caso real reportado) una cuenta de INGRESO como si
    // fuera válida para contabilizar una compra.
    const transactionalAccounts = allTransactionalAccounts.filter((account) =>
      isAllowedAccountCode(account.code),
    );

    if (transactionalAccounts.length === 0) {
      console.log(
        `[AI-CLASSIFY] [documentId=${documentId}] Omitido: 0 cuentas transaccionales permitidas (clase 5/6/7) para companyId=${companyId} — no se llamó a la IA.`,
      );
      return EMPTY_ITEM_CLASSIFICATION;
    }

    const supplierNit = normalizeSupplierDocument(
      document.payload.supplier.documentNumber ?? '',
    );
    const historicalPool = supplierNit
      ? await this.historialFacturasRepository.findRecentInvoicesBySupplier(
          companyId,
          integration.id,
          supplierNit,
          HISTORICAL_EXAMPLE_INVOICE_LIMIT,
        )
      : [];

    const itemDescriptions = document.payload.items.map(
      (item) => item.descripcion,
    );
    const promptItems = itemDescriptions.map((descripcion, index) => ({
      itemId: String(index + 1),
      descripcion,
    }));
    const supplierName = document.payload.supplier.name || 'Desconocido';
    const ourCompanyName = company?.name || 'nuestra empresa';
    const ourCompanyDescription = company?.description?.trim() || null;
    const documentKind = isSupportDocument
      ? 'SUPPORT_DOCUMENT'
      : 'PURCHASE_INVOICE';
    const hasProductsCatalog = productsCatalog.length > 0;

    const itemType = await this.resolveItemType({
      documentId,
      companyId,
      integrationId: integration.id,
      supplierNit,
      supplierDocumentType: document.payload.supplier.documentType,
      isSupportDocument,
      hasProductsCatalog,
      supplierName,
      ourCompanyName,
      ourCompanyDescription,
      documentKind,
      promptItems,
      historicalExamples: selectHistoricalExamplesForPrompt(
        itemDescriptions,
        splitSupplierHistory(historicalPool).invoiceRows,
      ).map((row) => ({
        descripcionItem: row.descripcionItem,
        itemType:
          row.tipo === HistorialFacturaTipo.PRODUCTO ? 'Product' : 'Account',
      })),
    });

    await onItemTypeResolved?.(itemType);

    if (itemType === 'Product') {
      const productsForPrompt = selectProductsForClassificationPrompt(
        itemDescriptions,
        productsCatalog,
      );
      const productCodes = new Set(
        productsCatalog.map((product) => product.code.trim()),
      );
      const productHistoryRows = historicalPool.filter(
        (row) =>
          row.tipo === HistorialFacturaTipo.PRODUCTO ||
          productCodes.has(row.cuentaPuc.trim()),
      );
      const productHistoricalExamples = attachCatalogNamesToHistoricalExamples(
        selectHistoricalExamplesForPrompt(
          itemDescriptions,
          splitSupplierHistory(productHistoryRows).invoiceRows,
        ).map((row) => ({
          descripcionItem: row.descripcionItem,
          cuentaPuc: row.cuentaPuc,
        })),
        productsCatalog,
      );

      const parsed = {
        items: await this.classifyCodesWithRetries(
          promptItems,
          (pendingItems) =>
            buildProductCodeClassificationPrompt({
              supplierName,
              ourCompanyName,
              ourCompanyDescription,
              documentKind,
              items: pendingItems,
              products: productsForPrompt,
              historicalExamples: productHistoricalExamples,
            }),
          parseProductCodeClassificationResponse,
          (item) =>
            productsCatalog.some((entry) => entry.code === item.productCode),
          {
            companyId,
            documentId,
            purpose: 'purchase-item-product-code-classification',
          },
        ),
      };
      const resolvedItems = parsed.items.map((item) => {
        const matchedProduct = item.productCode
          ? productsCatalog.find((product) => product.code === item.productCode)
          : undefined;

        if (item.productCode && !matchedProduct) {
          this.logger.warn(
            `[documentId=${documentId}] IA sugirió producto "${item.productCode}" que no existe en el catálogo; se descarta esa línea.`,
          );
        }

        return {
          accountCode: null,
          accountName: null,
          productCode: matchedProduct?.code ?? null,
          productName: matchedProduct?.name ?? null,
          confidence: matchedProduct ? item.confidence : 0,
        };
      });
      const unanimousProductCode = pickUnanimous(
        resolvedItems.map((item) => item.productCode),
      );
      const unanimousProduct = unanimousProductCode
        ? resolvedItems.find(
            (item) => item.productCode === unanimousProductCode,
          )
        : undefined;

      return {
        ...EMPTY_ITEM_CLASSIFICATION,
        itemType,
        productCode: unanimousProductCode,
        productName: unanimousProduct?.productName ?? null,
        confidence: pickMinimumConfidence(
          resolvedItems.map((item) => item.confidence),
        ),
        items: resolvedItems,
      };
    }

    const accountCodes = new Set(
      allTransactionalAccounts.map((account) => account.code.trim()),
    );
    const accountHistoryRows = historicalPool.filter(
      (row) =>
        row.tipo === HistorialFacturaTipo.CUENTA ||
        accountCodes.has(row.cuentaPuc.trim()),
    );
    const { invoiceRows, balanceRows } =
      splitSupplierHistory(accountHistoryRows);
    const accountHistoricalExamples = attachCatalogNamesToHistoricalExamples(
      selectHistoricalExamplesForPrompt(itemDescriptions, invoiceRows).map(
        (row) => ({
          descripcionItem: row.descripcionItem,
          cuentaPuc: row.cuentaPuc,
        }),
      ),
      allTransactionalAccounts,
    );
    const supplierUsedAccounts = uniqueSupplierUsedAccounts(
      balanceRows,
      allTransactionalAccounts,
    );

    const parsed = {
      items: await this.classifyCodesWithRetries(
        promptItems,
        (pendingItems) =>
          buildAccountCodeClassificationPrompt({
            supplierName,
            ourCompanyName,
            ourCompanyDescription,
            documentKind,
            items: pendingItems,
            accounts: transactionalAccounts.map((account) => ({
              code: account.code,
              name: account.name,
            })),
            historicalExamples: accountHistoricalExamples,
            supplierUsedAccounts,
          }),
        parseAccountCodeClassificationResponse,
        (item) =>
          transactionalAccounts.some(
            (entry) => entry.code === item.accountCode,
          ),
        {
          companyId,
          documentId,
          purpose: 'purchase-item-account-code-classification',
        },
      ),
    };
    const resolvedItems = parsed.items.map((item, index) => {
      const matchedAccount = transactionalAccounts.find(
        (account) => account.code === item.accountCode,
      );

      if (!matchedAccount) {
        return {
          accountCode: null,
          accountName: null,
          productCode: null,
          productName: null,
          confidence: 0,
        };
      }

      return {
        accountCode: matchedAccount.code,
        accountName: matchedAccount.name,
        productCode: null,
        productName: null,
        confidence: resolveAccountSuggestionConfidence({
          itemDescription: itemDescriptions[index] ?? '',
          accountCode: matchedAccount.code,
          historicalRows: accountHistoryRows,
        }),
      };
    });
    const unanimousAccountCode = pickUnanimous(
      resolvedItems.map((item) => item.accountCode),
    );
    const unanimousAccount = unanimousAccountCode
      ? resolvedItems.find((item) => item.accountCode === unanimousAccountCode)
      : undefined;

    return {
      ...EMPTY_ITEM_CLASSIFICATION,
      itemType,
      accountCode: unanimousAccountCode,
      accountName: unanimousAccount?.accountName ?? null,
      confidence: pickMinimumConfidence(
        resolvedItems.map((item) => item.confidence),
      ),
      items: resolvedItems,
    };
  }

  private async classifyCodesWithRetries<T>(
    items: Array<PurchaseItemClassificationPromptItem & { itemId: string }>,
    buildPrompt: (pending: typeof items) => OpenRouterMessage[],
    parse: (raw: string, ids: string[]) => { items: T[] },
    isValid: (item: T) => boolean,
    context: { companyId: string; documentId: string; purpose: string },
  ): Promise<T[]> {
    const resolved = new Map<string, T>();
    let pending = items;
    for (let attempt = 0; attempt < 3 && pending.length > 0; attempt++) {
      for (
        let offset = 0;
        offset < pending.length;
        offset += ITEM_CLASSIFICATION_BATCH_SIZE
      ) {
        const batch = pending.slice(
          offset,
          offset + ITEM_CLASSIFICATION_BATCH_SIZE,
        );
        try {
          const { content } =
            await this.openRouterHttpClient.createChatCompletion(
              buildPrompt(batch),
              { maxTokens: ITEM_CLASSIFICATION_MAX_TOKENS, context },
            );
          const parsed = parse(
            content,
            batch.map((item) => item.itemId),
          );
          batch.forEach((item, index) => {
            if (isValid(parsed.items[index]))
              resolved.set(item.itemId, parsed.items[index]);
          });
        } catch (error) {
          if (!(error instanceof BadGatewayException)) throw error;
          this.logger.warn(
            'Fallo de IA en intento ' +
              (attempt + 1) +
              '; se conservan los items resueltos.',
          );
        }
      }
      pending = pending.filter((item) => !resolved.has(item.itemId));
      if (pending.length && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
    if (pending.length) {
      this.logger.warn(
        'ítems sin código válido tras 3 intentos: ' +
          pending.map((item) => item.itemId).join(', '),
      );
    }
    const empty = parse(
      '',
      items.map((item) => item.itemId),
    ).items;
    return items.map(
      (item, index) => resolved.get(item.itemId) ?? empty[index],
    );
  }

  /**
   * Paso 1: decide Cuenta vs Producto SIN gastar catálogos en el prompt.
   * Orden de resolución: (a) documento soporte → siempre Cuenta; (b) empresa
   * sin catálogo de productos → siempre Cuenta (nunca tuvo sentido ofrecer
   * "Producto"); (c) tipo fijo ya calculado por el sync de historial de este
   * proveedor (campoVariabilidad.tipoItem, ≥70% de sus líneas del mismo
   * tipo) → se usa DIRECTO, sin llamar a la IA; (d) si nada de lo anterior
   * resuelve el tipo, ahí sí se llama a la IA con un prompt mínimo (sin
   * catálogos) para que decida.
   */
  private async resolveItemType(params: {
    documentId: string;
    companyId: string;
    integrationId: string;
    supplierNit: string;
    supplierDocumentType: string | undefined;
    isSupportDocument: boolean;
    hasProductsCatalog: boolean;
    supplierName: string;
    ourCompanyName: string;
    ourCompanyDescription: string | null;
    documentKind: 'PURCHASE_INVOICE' | 'SUPPORT_DOCUMENT';
    promptItems: PurchaseItemClassificationPromptItem[];
    historicalExamples: Array<{
      descripcionItem: string;
      itemType: 'Account' | 'Product';
    }>;
  }): Promise<'Account' | 'Product'> {
    const {
      documentId,
      companyId,
      integrationId,
      supplierNit,
      isSupportDocument,
      hasProductsCatalog,
      supplierName,
      ourCompanyName,
      ourCompanyDescription,
      documentKind,
      promptItems,
      historicalExamples,
    } = params;

    if (isSupportDocument || !hasProductsCatalog) {
      return 'Account';
    }

    if (supplierNit) {
      const configuration =
        await this.supplierConfigurationsRepository.findByCompanyIntegrationAndNormalizedSupplierDocument(
          companyId,
          integrationId,
          supplierNit,
        );
      const dbItemType =
        resolveSuggestedItemConfigFromConfiguration(configuration)?.itemType ??
        null;

      if (dbItemType) {
        console.log(
          `[AI-CLASSIFY] [documentId=${documentId}] Paso 1: itemType="${dbItemType}" resuelto desde el historial del proveedor (BD) — no se llamó a la IA.`,
        );
        return dbItemType;
      }
    }

    const prompt = buildItemTypeClassificationPrompt({
      supplierName,
      ourCompanyName,
      ourCompanyDescription,
      documentKind,
      items: promptItems,
      historicalExamples,
    });

    console.log(
      `[AI-CLASSIFY] [documentId=${documentId}] Paso 1 (tipo) ANTES de llamar a OpenRouter — historicoLineas=${historicalExamples.length}.`,
    );

    const { content: rawText } =
      await this.openRouterHttpClient.createChatCompletion(prompt, {
        maxTokens: ITEM_TYPE_CLASSIFICATION_MAX_TOKENS,
        context: {
          companyId,
          documentId,
          purpose: 'purchase-item-type-classification',
        },
      });

    console.log(
      `[AI-CLASSIFY] [documentId=${documentId}] Paso 1 (tipo) DESPUÉS de llamar a OpenRouter — respuesta cruda: ${rawText}`,
    );

    // Sin señal fuerte ninguna (ni historial, ni una respuesta parseable),
    // "Account" es el fallback seguro: siempre es una opción válida (las
    // cuentas PUC de gasto/costo son categorías amplias), a diferencia de
    // "Product" que requeriría un match real en el catálogo.
    return parseItemTypeClassificationResponse(rawText).itemType ?? 'Account';
  }
}
