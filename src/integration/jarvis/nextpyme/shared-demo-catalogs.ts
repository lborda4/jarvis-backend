/** Provider fixtures only. Forms, validations and business records remain the production implementation. */
type Row = { id: number; name: string; code?: string; [key: string]: unknown };
const rows = (values: Array<[number, string, string?]>): Row[] =>
  values.map(([id, name, code]) => ({ id, name, code }));
const regimes = rows([
  [1, 'Responsable de IVA', '48'],
  [2, 'No responsable de IVA', '49'],
]);
const identifications = rows([
  [3, 'Cédula de ciudadanía', '13'],
  [5, 'Cédula de extranjería', '22'],
  [6, 'NIT', '31'],
  [7, 'Pasaporte', '41'],
]);
export const sharedDemoCatalogs: Record<string, Row[]> = {
  taxes: rows([
    [1, 'IVA', '01'],
    [4, 'INC', '04'],
    [5, 'ReteIVA', '05'],
    [6, 'Retefuente', '06'],
    [7, 'ReteICA', '07'],
  ]),
  payment_methods: rows([
    [10, 'Efectivo', '10'],
    [47, 'Transferencia débito bancaria', '47'],
    [48, 'Tarjeta de crédito', '48'],
    [49, 'Tarjeta débito', '49'],
    [1, 'Instrumento no definido', '1'],
  ]),
  payment_forms: rows([
    [1, 'Contado', '1'],
    [2, 'Crédito', '2'],
  ]),
  type_currencies: rows([
    [35, 'Peso colombiano', 'COP'],
    [149, 'Dólar estadounidense', 'USD'],
    [46, 'Euro', 'EUR'],
  ]),
  municipalities: rows([
    [149, 'Bogotá, D.C.', '11001'],
    [1, 'Medellín', '05001'],
    [1006, 'Cali', '76001'],
    [82, 'Barranquilla', '08001'],
  ]),
  unit_measures: rows([
    [70, 'Unidad', '94'],
    [821, 'Servicio', 'E48'],
    [23, 'Kilogramo', 'KGM'],
    [642, 'Hora', 'HUR'],
  ]),
  type_liabilities: rows([
    [117, 'No aplica – Otros', 'R-99-PN'],
    [7, 'Gran contribuyente', 'O-13'],
    [9, 'Autorretenedor', 'O-15'],
    [14, 'Régimen simple de tributación', 'O-47'],
  ]),
  type_regime: regimes,
  type_regimes: regimes,
  type_document_identifications: identifications,
  payroll_type_document_identifications: identifications,
  type_organizations: rows([
    [1, 'Persona jurídica', '1'],
    [2, 'Persona natural', '2'],
  ]),
  type_workers: rows([
    [1, 'Dependiente', '01'],
    [2, 'Servicio doméstico', '02'],
  ]),
  sub_type_workers: rows([
    [1, 'No aplica', '00'],
    [2, 'Dependiente pensionado por vejez', '01'],
  ]),
  type_contracts: rows([
    [1, 'Término fijo'],
    [2, 'Término indefinido'],
    [3, 'Obra o labor'],
    [4, 'Aprendizaje'],
    [5, 'Ocasional'],
  ]),
  payroll_periods: rows([
    [4, 'Quincenal', '4'],
    [5, 'Mensual', '5'],
  ]),
  type_law_deductions: [
    { id: 1, name: '4 %', percentage: 4, code: '4.00' },
    { id: 2, name: '8 %', percentage: 8, code: '8.00' },
  ],
  type_disabilities: rows([
    [1, 'Incapacidad común'],
    [2, 'Incapacidad profesional'],
  ]),
  type_overtime_surcharges: rows([
    [1, 'Hora extra diurna', 'HED'],
    [2, 'Hora extra nocturna', 'HEN'],
    [3, 'Recargo nocturno', 'HRN'],
    [4, 'Hora extra diurna dominical y festiva', 'HEDDF'],
    [5, 'Recargo diurno dominical y festivo', 'HRDDF'],
    [6, 'Hora extra nocturna dominical y festiva', 'HENDF'],
    [7, 'Recargo nocturno dominical y festivo', 'HRNDF'],
  ]),
  type_rejections: rows([
    [1, 'Documento con inconsistencias'],
    [2, 'Mercancía no entregada totalmente'],
    [3, 'Mercancía no entregada parcialmente'],
    [4, 'Servicio no prestado'],
  ]),
  credit_note_discrepancy_responses: rows([
    [1, 'Devolución parcial de bienes'],
    [2, 'Anulación de factura electrónica'],
    [3, 'Rebaja total aplicada'],
    [4, 'Descuento total aplicado'],
    [5, 'Rescisión de contrato'],
    [6, 'Otros'],
  ]),
  debit_note_discrepancy_responses: rows([
    [1, 'Intereses'],
    [2, 'Gastos por cobrar'],
    [3, 'Cambio del valor'],
    [4, 'Otros'],
  ]),
};
