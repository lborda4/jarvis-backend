// Sales data extracted from the supplied workbook. No spreadsheet instructions are executed.
export const jeniusWorkbook = {
  "source": "Modelo_costos_punto_equilibrio_JENIUS_actualizado.xlsx",
  "sheet": "Productos",
  "rates": {
    "BASIC": {
      "initial": 0.1,
      "renewal": 0.05
    },
    "PLUS": {
      "initial": 0.15,
      "renewal": 0.075
    },
    "PRO": {
      "initial": 0.2,
      "renewal": 0.1
    }
  },
  "products": [
    {
      "row": 6,
      "class": "BASICA",
      "name": "Facturación electrónica",
      "priceCop": 139900
    },
    {
      "row": 7,
      "class": "PLUS",
      "name": "Recarga 10",
      "priceCop": 25000
    },
    {
      "row": 8,
      "class": "PLUS",
      "name": "Recarga 25",
      "priceCop": 45000
    },
    {
      "row": 9,
      "class": "PLUS",
      "name": "Recarga 50",
      "priceCop": 80000
    },
    {
      "row": 10,
      "class": "PLUS",
      "name": "Recarga 100",
      "priceCop": 149900
    },
    {
      "row": 11,
      "class": "PRO",
      "name": "Recarga 250",
      "priceCop": 300000
    },
    {
      "row": 12,
      "class": "PRO",
      "name": "Recarga 500",
      "priceCop": 480000
    },
    {
      "row": 13,
      "class": "BASICA",
      "name": "Nómina electrónica",
      "priceCop": 129900
    },
    {
      "row": 14,
      "class": "PLUS",
      "name": "Recarga 1 empleado",
      "priceCop": 20000
    },
    {
      "row": 15,
      "class": "PLUS",
      "name": "Recarga 2 empleados",
      "priceCop": 38000
    },
    {
      "row": 16,
      "class": "PLUS",
      "name": "Recarga 3 empleados",
      "priceCop": 55000
    },
    {
      "row": 17,
      "class": "PLUS",
      "name": "Recarga 4 empleados",
      "priceCop": 72000
    },
    {
      "row": 18,
      "class": "PLUS",
      "name": "Recarga 5 empleados",
      "priceCop": 88000
    },
    {
      "row": 19,
      "class": "PLUS",
      "name": "Recarga 6 empleados",
      "priceCop": 104000
    },
    {
      "row": 20,
      "class": "PLUS",
      "name": "Recarga 7 empleados",
      "priceCop": 119000
    },
    {
      "row": 21,
      "class": "PLUS",
      "name": "Recarga 8 empleados",
      "priceCop": 134000
    },
    {
      "row": 22,
      "class": "PLUS",
      "name": "Recarga 9 empleados",
      "priceCop": 148000
    },
    {
      "row": 23,
      "class": "PLUS",
      "name": "Recarga 10 empleados",
      "priceCop": 162000
    },
    {
      "row": 24,
      "class": "PRO",
      "name": "Recarga 11 empleados",
      "priceCop": 175000
    },
    {
      "row": 25,
      "class": "PRO",
      "name": "Recarga 15 empleados",
      "priceCop": 225000
    },
    {
      "row": 26,
      "class": "PRO",
      "name": "Recarga 20 empleados",
      "priceCop": 290000
    },
    {
      "row": 27,
      "class": "PRO",
      "name": "Recarga 30 empleados",
      "priceCop": 405000
    },
    {
      "row": 28,
      "class": "PRO",
      "name": "Combo facturacion y nomina",
      "priceCop": 230000
    },
    {
      "row": 29,
      "class": "PRO",
      "name": "Nómina y facturacion ilimitada",
      "priceCop": 720000
    },
    {
      "row": 30,
      "class": "PLUS",
      "name": "Causación automática",
      "priceCop": 400000
    }
  ],
  "example": {
    "expectedCommissionCop": 1951550,
    "rows": [
      {
        "name": "Facturación electrónica",
        "priceCop": 139900,
        "quantity": 70,
        "class": "BASICA"
      },
      {
        "name": "Recarga 25",
        "priceCop": 45000,
        "quantity": 35,
        "class": "PLUS"
      },
      {
        "name": "Combo facturacion y nomina",
        "priceCop": 230000,
        "quantity": 16,
        "class": "PRO"
      }
    ]
  }
} as const;
