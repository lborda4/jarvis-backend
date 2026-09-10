import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ElectronicDocumentService } from '../../electronic-document/electronic-document.service';
import { HistorialFacturasRepository } from '../repositories/historial-facturas.repository';
import { HistorialFacturaFuente } from '../enums/historial-factura-fuente.enum';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { SiigoAccountsRepository } from '../repositories/siigo-accounts.repository';
import { OpenRouterHttpClient } from '../openrouter/clients/openrouter-http.client';
import {
  buildAccountNameByCode,
  isAllowedAccountCode,
  resolveAccountNameFromCatalog,
} from '../helpers/supplier-accounts-catalog.helper';
import {
  buildPurchaseClassificationPrompt,
  parsePurchaseClassificationResponse,
} from './helpers/purchase-classification-prompt.helper';
import {
  buildPurchaseItemClassificationPrompt,
  parsePurchaseItemClassificationResponse,
} from './helpers/purchase-item-classification-prompt.helper';
import { SuggestPurchaseItemClassificationResponseDto } from './dto/suggest-purchase-item-classification.dto';
import {
  getSiigoIntegration,
  normalizeSupplierDocument,
} from './helpers/siigo-context.helper';
import { SiigoAccountsCatalogService } from './siigo-accounts-catalog.service';
import { SiigoProductsCatalogService } from './siigo-products-catalog.service';
import { SiigoProductCatalogItemDto } from './dto/list-siigo-products.dto';
import { SiigoTaxesCatalogService } from './siigo-taxes-catalog.service';

// Pocos ejemplos a propósito — no todo el historial: cada uno se manda en
// cada llamada a la IA y suma tokens (y costo) por documento clasificado.
const HISTORICAL_EXAMPLES_LIMIT = 5;
// Respuesta angosta (itemType + accountCode nada más): alcanza con pocos
// tokens de salida — probado en vivo con openai/gpt-4o-mini en ~15-20 tokens
// reales de respuesta.
const ITEM_CLASSIFICATION_MAX_TOKENS = 2000;
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

export interface ItemTypeAndAccountClassification {
  itemType: 'Account' | 'Product' | null;
  accountCode: string | null;
  accountName: string | null;
  productCode: string | null;
  productName: string | null;
  /** 0-100 — ver ParsedPurchaseItemClassification.confidence. null cuando
   * no hubo clasificación en absoluto (ej. sin catálogo de cuentas). */
  confidence: number | null;
}

const EMPTY_ITEM_CLASSIFICATION: ItemTypeAndAccountClassification = {
  itemType: null,
  accountCode: null,
  accountName: null,
  productCode: null,
  productName: null,
  confidence: null,
};

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
  ) {}

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

    const [accounts, allTaxes, integration] = await Promise.all([
      this.siigoAccountsCatalogService.listAccounts(companyId),
      this.siigoTaxesCatalogService.listTaxes({}, companyId),
      getSiigoIntegration(this.integrationsRepository, companyId),
    ]);

    if (accounts.length === 0) {
      throw new BadRequestException(
        'No hay catálogo de cuentas contables sincronizado. Ejecute la sincronización de catálogos SIIGO primero.',
      );
    }

    const activeIvaTaxes = allTaxes.filter(
      (tax) => tax.active && tax.type?.trim().toLowerCase() === 'iva',
    );
    const activeRetentionTaxes = allTaxes.filter(
      (tax) => tax.active && tax.type?.trim().toLowerCase() !== 'iva',
    );

    const supplierNit = normalizeSupplierDocument(
      document.payload.supplier.documentNumber ?? '',
    );
    const historicalRows = supplierNit
      ? await this.historialFacturasRepository.findRecentBySupplier(
          companyId,
          integration.id,
          supplierNit,
          HISTORICAL_EXAMPLES_LIMIT,
        )
      : [];

    const prompt = buildPurchaseClassificationPrompt({
      supplierName: document.payload.supplier.name || 'Desconocido',
      items: document.payload.items.map((item) => ({
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        valorUnitario: item.valorUnitario,
      })),
      accounts,
      taxes: activeIvaTaxes,
      retentionTaxes: activeRetentionTaxes,
      historicalExamples: historicalRows.map((row) => ({
        descripcionItem: row.descripcionItem,
        cuentaPuc: row.cuentaPuc,
        impuestos: row.impuestos,
        confirmadaPorContador:
          row.fuente === HistorialFacturaFuente.CORREGIDO_CONTADOR,
      })),
    });

    const { content: rawText } =
      await this.openRouterHttpClient.createChatCompletion(prompt, {
        context: {
          companyId,
          documentId,
          purpose: 'purchase-full-classification',
        },
      });
    const parsed = parsePurchaseClassificationResponse(rawText);

    const matchedAccount = parsed.accountCode
      ? (accounts.find((account) => account.code === parsed.accountCode) ??
        null)
      : null;
    const matchedTax =
      parsed.taxId != null
        ? (activeIvaTaxes.find((tax) => tax.id === parsed.taxId) ?? null)
        : null;
    const matchedRetentions = parsed.retentionIds
      .map((id) => activeRetentionTaxes.find((tax) => tax.id === id))
      .filter((tax): tax is NonNullable<typeof tax> => Boolean(tax));

    if (parsed.accountCode && !matchedAccount) {
      this.logger.warn(
        `[documentId=${documentId}] IA sugirió cuenta "${parsed.accountCode}" que no existe en el catálogo; se descarta.`,
      );
    }

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
      accountCode: matchedAccount?.code ?? null,
      accountName: matchedAccount?.name ?? null,
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
   * Clasificación angosta para el disparo automático en background (ver
   * SiigoPurchaseAiClassificationService): a diferencia de
   * `suggestForDocument` (botón manual, respuesta amplia con IVA y
   * retenciones), esta solo pide tipo de ítem (Cuenta/Producto) + código de
   * cuenta, contra el catálogo de cuentas TRANSACCIONALES únicamente, para
   * minimizar tokens tanto de entrada como de salida.
   */
  async classifyItemTypeAndAccount(
    documentId: string,
    companyId: string,
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

    const [allTransactionalAccounts, productsCatalog] = await Promise.all([
      this.siigoAccountsRepository.findTransactionalByCompanyAndIntegration(
        companyId,
        integration.id,
      ),
      this.siigoProductsCatalogService
        .listProducts(companyId)
        .catch((): SiigoProductCatalogItemDto[] => []),
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
    const historicalRows = supplierNit
      ? await this.historialFacturasRepository.findRecentBySupplier(
          companyId,
          integration.id,
          supplierNit,
          HISTORICAL_EXAMPLES_LIMIT,
        )
      : [];

    const itemDescriptions = document.payload.items.map(
      (item) => item.descripcion,
    );
    const productsForPrompt = selectProductsForClassificationPrompt(
      itemDescriptions,
      productsCatalog,
    );

    const prompt = buildPurchaseItemClassificationPrompt({
      supplierName: document.payload.supplier.name || 'Desconocido',
      items: itemDescriptions.map((descripcion) => ({ descripcion })),
      accounts: transactionalAccounts.map((account) => ({
        code: account.code,
        name: account.name,
      })),
      products: productsForPrompt,
      historicalExamples: historicalRows.map((row) => ({
        descripcionItem: row.descripcionItem,
        cuentaPuc: row.cuentaPuc,
      })),
    });

    console.log(
      `[AI-CLASSIFY] [documentId=${documentId}] ANTES de llamar a OpenRouter — ${new Date().toISOString()} — items=${JSON.stringify(itemDescriptions)}, cuentasEnPrompt=${transactionalAccounts.length}, productosEnPrompt=${productsForPrompt.length}`,
    );

    const { content: rawText } =
      await this.openRouterHttpClient.createChatCompletion(prompt, {
        maxTokens: ITEM_CLASSIFICATION_MAX_TOKENS,
        context: {
          companyId,
          documentId,
          purpose: 'purchase-item-classification',
        },
      });

    console.log(
      `[AI-CLASSIFY] [documentId=${documentId}] DESPUÉS de llamar a OpenRouter — ${new Date().toISOString()} — respuesta cruda: ${rawText}`,
    );

    const parsed = parsePurchaseItemClassificationResponse(rawText);

    console.log(
      `[AI-CLASSIFY] [documentId=${documentId}] Respuesta parseada: ${JSON.stringify(parsed)}`,
    );

    if (parsed.itemType === 'Product') {
      if (!parsed.productCode) {
        return {
          ...EMPTY_ITEM_CLASSIFICATION,
          itemType: parsed.itemType,
        };
      }

      const matchedProduct = productsCatalog.find(
        (product) => product.code === parsed.productCode,
      );

      if (!matchedProduct) {
        this.logger.warn(
          `[documentId=${documentId}] IA sugirió producto "${parsed.productCode}" que no existe en el catálogo; se descarta.`,
        );

        return {
          ...EMPTY_ITEM_CLASSIFICATION,
          itemType: parsed.itemType,
        };
      }

      return {
        ...EMPTY_ITEM_CLASSIFICATION,
        itemType: parsed.itemType,
        productCode: matchedProduct.code,
        productName: matchedProduct.name,
        confidence: parsed.confidence,
      };
    }

    if (parsed.itemType !== 'Account' || !parsed.accountCode) {
      return {
        ...EMPTY_ITEM_CLASSIFICATION,
        itemType: parsed.itemType,
      };
    }

    const accountNameByCode = buildAccountNameByCode(transactionalAccounts);
    const matchedAccount = transactionalAccounts.find(
      (account) => account.code === parsed.accountCode,
    );

    if (!matchedAccount) {
      this.logger.warn(
        `[documentId=${documentId}] IA sugirió cuenta "${parsed.accountCode}" que no existe en el catálogo transaccional; se descarta.`,
      );

      return {
        ...EMPTY_ITEM_CLASSIFICATION,
        itemType: parsed.itemType,
      };
    }

    return {
      ...EMPTY_ITEM_CLASSIFICATION,
      itemType: parsed.itemType,
      accountCode: matchedAccount.code,
      accountName: resolveAccountNameFromCatalog(
        matchedAccount.code,
        matchedAccount.name,
        accountNameByCode,
      ),
      confidence: parsed.confidence,
    };
  }
}
