import { HistorialFacturaFuente } from '../../enums/historial-factura-fuente.enum';
import { applyItemClassificationToPayload } from '../../../electronic-document/helpers/electronic-document-account-mapping.helper';
import { resolvePurchaseInvoiceRequiresReview } from '../../../electronic-document/helpers/purchase-invoice-review.helper';
import { ElectronicDocumentPayload } from '../../../electronic-document/interfaces/electronic-document-payload.interface';
import { resolveRequiredAccountFromCatalog } from '../../helpers/supplier-accounts-catalog.helper';
import {
  ACCOUNT_CONFIDENCE,
  resolveAccountSuggestionConfidence,
} from './account-suggestion-confidence.helper';
import { selectHistoricalExamplesForPrompt } from './select-historical-examples.helper';

/** Cuentas de compra reales vistas en QA (clases 5/6/7). */
const CATALOG = [
  { code: '51356002', name: 'Servicio Linea Telefonica' },
  { code: '51452501', name: 'Herramientas' },
  { code: '51952503', name: 'Elementos de aseo y Cafetería' },
  { code: '51953001', name: 'Papelería y útiles de oficina' },
  { code: '61350596', name: 'Costos Inventario Chia' },
];

function classifyAccountLines(params: {
  descriptions: string[];
  aiCodes: Array<string | null>;
  historicalRows: Array<{
    descripcionItem: string;
    cuentaPuc: string;
    fuente?: string;
  }>;
}) {
  const historicalCodes = selectHistoricalExamplesForPrompt(
    params.descriptions,
    params.historicalRows,
  ).map((row) => row.cuentaPuc);

  return params.descriptions.map((descripcion, index) => {
    const account = resolveRequiredAccountFromCatalog(CATALOG, [
      params.aiCodes[index],
      ...historicalCodes,
    ]);

    return {
      descripcion,
      accountCode: account?.code ?? null,
      accountName: account?.name ?? null,
      confidence: account
        ? resolveAccountSuggestionConfidence({
            itemDescription: descripcion,
            accountCode: account.code,
            historicalRows: params.historicalRows,
          })
        : 0,
    };
  });
}

function reviewFor(lines: ReturnType<typeof classifyAccountLines>) {
  const payload = applyItemClassificationToPayload(
    {
      items: lines.map((line) => ({
        descripcion: line.descripcion,
        cantidad: 1,
        valorUnitario: 1000,
        total: 1000,
      })),
    } as ElectronicDocumentPayload,
    {
      itemType: 'Account',
      accountCode: lines.every((line) => line.accountCode === lines[0].accountCode)
        ? lines[0].accountCode
        : null,
      accountName: lines[0].accountName,
      productCode: null,
      productName: null,
      confidence: Math.min(...lines.map((line) => line.confidence)),
      items: lines.map((line) => ({
        accountCode: line.accountCode,
        accountName: line.accountName,
        productCode: null,
        productName: null,
        confidence: line.confidence,
      })),
    },
  );

  return resolvePurchaseInvoiceRequiresReview({
    draft: null,
    payloadItems: payload.items,
    suggestedAccount: payload.aiSuggestion?.account
      ? { ...payload.aiSuggestion.account, uses: 1 }
      : null,
    suggestedProduct: null,
    suggestedItemConfig: {
      itemType: 'Account',
      accountCode: payload.aiSuggestion?.account?.code ?? null,
      accountName: payload.aiSuggestion?.account?.name ?? null,
      productCode: null,
      productName: null,
      ivaTax: null,
      retefuenteTax: null,
      paymentMethod: { id: 5056, name: 'Crédito proveedores', type: 'Proveedor' },
    },
    itemAccountSuggestions: payload.items.map((item) =>
      item.accountMapping?.code
        ? {
            code: item.accountMapping.code,
            name: item.accountMapping.description ?? item.accountMapping.code,
            source: 'fallback' as const,
          }
        : null,
    ),
    aiConfidence: payload.aiSuggestion?.confidence ?? null,
    aiClassificationAttempted: true,
  });
}

describe('casos reales de clasificación de cuenta (QA)', () => {
  it('Colombia Telecomunicaciones BEC547013731: hoy clasifica bien y sigue con cuenta llena', () => {
    const lines = classifyAccountLines({
      descriptions: ['Factura electrónica recibida'],
      aiCodes: ['51356002'],
      historicalRows: [
        {
          descripcionItem: 'Servicio Linea Telefonica',
          cuentaPuc: '51356002',
          fuente: HistorialFacturaFuente.SIIGO_ORIGINAL,
        },
      ],
    });

    expect(lines[0].accountCode).toBe('51356002');
    expect(lines[0].confidence).toBe(ACCOUNT_CONFIDENCE.CATALOG);
    expect(lines.every((line) => line.accountCode)).toBe(true);
  });

  it('Jose Isidro POSE48014: descripción exacta confirmada, alta, sin líneas vacías', () => {
    const lines = classifyAccountLines({
      descriptions: [
        'CANDADO MARINO 60MM ISEO',
        'CHAZO SUPRA CAIMAN PLASTICO 1/',
      ],
      aiCodes: [null, null],
      historicalRows: [
        {
          descripcionItem: 'CANDADO MARINO 60MM ISEO',
          cuentaPuc: '51452501',
          fuente: HistorialFacturaFuente.CORREGIDO_CONTADOR,
        },
        {
          descripcionItem: 'CHAZO SUPRA CAIMAN PLASTICO 1/',
          cuentaPuc: '51452501',
          fuente: HistorialFacturaFuente.CORREGIDO_CONTADOR,
        },
      ],
    });

    expect(lines.map((line) => line.accountCode)).toEqual([
      '51452501',
      '51452501',
    ]);
    expect(lines[0].confidence).toBe(ACCOUNT_CONFIDENCE.EXACT_CONFIRMED);
    expect(reviewFor(lines)).toBe(false);
  });

  it('CROYDON FNC926410: hoy clasifica mal (vacía); con catálogo queda llena y en revisión', () => {
    const lines = classifyAccountLines({
      descriptions: ['DISCOVERY ALTO AZUL CROYDON'],
      aiCodes: ['NO-EXISTE'],
      historicalRows: [
        {
          descripcionItem: 'TENIS COLEGIAL XX PC NEGRO REF: AD86090 TALLA 34',
          cuentaPuc: 'TENISCLGIALXXPCNEGRRAD86090T34',
        },
      ],
    });

    expect(lines[0].accountCode).toBe('51356002');
    expect(lines[0].confidence).toBe(ACCOUNT_CONFIDENCE.CATALOG);
    expect(reviewFor(lines)).toBe(true);
  });

  it('BELPAPEL BECT49443: resmas con histórico de papelería; el ítem nuevo no queda vacío y va a revisión', () => {
    const lines = classifyAccountLines({
      descriptions: [
        'RESMA PAPEL CARTA 75G',
        'RESMA PAPEL OFICIO 75G',
        'CINTA EMPAQUE TRANSPARENTE',
      ],
      aiCodes: [null, 'NO-EXISTE', null],
      historicalRows: [
        {
          descripcionItem: 'RESMA PAPEL CARTA 75G',
          cuentaPuc: '51953001',
          fuente: HistorialFacturaFuente.CORREGIDO_CONTADOR,
        },
        {
          descripcionItem: 'RESMA PAPEL CARTA 90G',
          cuentaPuc: '51953001',
          fuente: HistorialFacturaFuente.SIIGO_ORIGINAL,
        },
        {
          descripcionItem: 'Referencia de balance por tercero',
          cuentaPuc: '51953001',
          fuente: HistorialFacturaFuente.SIIGO_BALANCE_TERCERO,
        },
      ],
    });

    expect(lines.every((line) => line.accountCode)).toBe(true);
    expect(lines[0].accountCode).toBe('51953001');
    expect(lines[0].confidence).toBe(ACCOUNT_CONFIDENCE.EXACT_CONFIRMED);
    expect(lines[1].accountCode).toBe('51953001');
    expect(lines[1].confidence).toBe(ACCOUNT_CONFIDENCE.SIMILAR_INVOICE);
    expect(lines[2].accountCode).toBe('51953001');
    expect(lines[2].confidence).toBe(ACCOUNT_CONFIDENCE.BALANCE_THIRD_PARTY);
    expect(reviewFor(lines)).toBe(true);
  });

  it('proveedor nuevo HOTEL SEXTA AVENIDA FH11951: sin historial, cuenta de catálogo y Requiere revisión', () => {
    const lines = classifyAccountLines({
      descriptions: ['HOSPEDAJE HABITACION SENCILLA'],
      aiCodes: [null],
      historicalRows: [],
    });

    expect(lines[0].accountCode).toBe('51356002');
    expect(lines[0].confidence).toBe(ACCOUNT_CONFIDENCE.CATALOG);
    expect(reviewFor(lines)).toBe(true);
  });

  it('D1 M0X384295: varios conceptos; ninguna línea vacía y las débiles marcan revisión', () => {
    const lines = classifyAccountLines({
      descriptions: [
        'DESENGRASANTE BRILLA',
        'TOSTADA CLASICA HORN',
        'PAPEL PARA FREIDORA',
      ],
      aiCodes: [null, null, null],
      historicalRows: [
        {
          descripcionItem: 'Elementos de aseo y Cafetería',
          cuentaPuc: '51952503',
          fuente: HistorialFacturaFuente.SIIGO_ORIGINAL,
        },
      ],
    });

    expect(lines.every((line) => line.accountCode)).toBe(true);
    expect(new Set(lines.map((line) => line.accountCode)).size).toBeGreaterThan(
      0,
    );
    expect(lines.some((line) => line.confidence < 80)).toBe(true);
    expect(reviewFor(lines)).toBe(true);
  });
});
