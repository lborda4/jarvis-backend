import { JarvisTaxCategory } from '../enums/jarvis-tax-category.enum';

export const JARVIS_DEFAULT_TAXES = [
  {
    "code": "501",
    "name": "INC | 4%",
    "taxType": "INC",
    "rate": "4",
    "isActive": true,
    "category": "IMPUESTO"
  },
  {
    "code": "502",
    "name": "INC | 8%",
    "taxType": "INC",
    "rate": "8",
    "isActive": true,
    "category": "IMPUESTO"
  },
  {
    "code": "503",
    "name": "INC | 16%",
    "taxType": "INC",
    "rate": "16",
    "isActive": true,
    "category": "IMPUESTO"
  },
  {
    "code": "301",
    "name": "ReteIVA | 15%",
    "taxType": "ReteIVA",
    "rate": "15",
    "isActive": true,
    "category": "RETENCION"
  },
  {
    "code": "302",
    "name": "ReteIVA | 100%",
    "taxType": "ReteIVA",
    "rate": "100",
    "isActive": true,
    "category": "RETENCION"
  },
  {
    "code": "214",
    "name": "Retefuente | 1%",
    "taxType": "Retefuente",
    "rate": "1",
    "isActive": true,
    "category": "RETENCION"
  },
  {
    "code": "213",
    "name": "Retefuente | 2%",
    "taxType": "Retefuente",
    "rate": "2",
    "isActive": true,
    "category": "RETENCION"
  },
  {
    "code": "209",
    "name": "Retefuente | 2,5%",
    "taxType": "Retefuente",
    "rate": "2.5",
    "isActive": true,
    "category": "RETENCION"
  },
  {
    "code": "210",
    "name": "Retefuente | 3,5%",
    "taxType": "Retefuente",
    "rate": "3.5",
    "isActive": true,
    "category": "RETENCION"
  },
  {
    "code": "207",
    "name": "Retefuente | 4%",
    "taxType": "Retefuente",
    "rate": "4",
    "isActive": true,
    "category": "RETENCION"
  },
  {
    "code": "208",
    "name": "Retefuente | 6%",
    "taxType": "Retefuente",
    "rate": "6",
    "isActive": true,
    "category": "RETENCION"
  },
  {
    "code": "201",
    "name": "Retefuente | 10%",
    "taxType": "Retefuente",
    "rate": "10",
    "isActive": true,
    "category": "RETENCION"
  },
  {
    "code": "202",
    "name": "Retefuente | 11%",
    "taxType": "Retefuente",
    "rate": "11",
    "isActive": true,
    "category": "RETENCION"
  },
  {
    "code": "401",
    "name": "ReteICA | 4,14 x 1.000",
    "taxType": "ReteICA",
    "rate": "4.14",
    "isActive": true,
    "category": "RETENCION"
  },
  {
    "code": "402",
    "name": "ReteICA | 6,90 x 1.000",
    "taxType": "ReteICA",
    "rate": "6.9",
    "isActive": true,
    "category": "RETENCION"
  },
  {
    "code": "407",
    "name": "ReteICA | 7,00 x 1.000",
    "taxType": "ReteICA",
    "rate": "7",
    "isActive": true,
    "category": "RETENCION"
  },
  {
    "code": "408",
    "name": "ReteICA | 8,00 x 1.000",
    "taxType": "ReteICA",
    "rate": "8",
    "isActive": true,
    "category": "RETENCION"
  },
  {
    "code": "403",
    "name": "ReteICA | 9,66 x 1.000",
    "taxType": "ReteICA",
    "rate": "9.66",
    "isActive": true,
    "category": "RETENCION"
  },
  {
    "code": "404",
    "name": "ReteICA | 11,04 x 1.000",
    "taxType": "ReteICA",
    "rate": "11.04",
    "isActive": true,
    "category": "RETENCION"
  },
  {
    "code": "405",
    "name": "ReteICA | 13,80 x 1.000",
    "taxType": "ReteICA",
    "rate": "13.8",
    "isActive": true,
    "category": "RETENCION"
  },
  {
    "code": "406",
    "name": "ReteICA | 14,00 x 1.000",
    "taxType": "ReteICA",
    "rate": "14",
    "isActive": true,
    "category": "RETENCION"
  },
  {
    "code": "103",
    "name": "IVA | 0%",
    "taxType": "IVA",
    "rate": "0",
    "isActive": true,
    "category": "IMPUESTO"
  },
  {
    "code": "102",
    "name": "IVA | 5%",
    "taxType": "IVA",
    "rate": "5",
    "isActive": true,
    "category": "IMPUESTO"
  },
  {
    "code": "101",
    "name": "IVA | 19%",
    "taxType": "IVA",
    "rate": "19",
    "isActive": true,
    "category": "IMPUESTO"
  }
].map(tax => ({ ...tax, category: tax.category as JarvisTaxCategory }));
