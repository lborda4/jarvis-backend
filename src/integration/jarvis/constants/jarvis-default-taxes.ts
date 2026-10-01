import { JarvisTaxCategory } from '../enums/jarvis-tax-category.enum';

const entries: Array<[string, string, string, number]> = [
  ['101', 'IVA General 19%', 'IVA', 19],
  ['102', 'IVA Reducido 5%', 'IVA', 5],
  ['103', 'IVA Exento 0%', 'IVA', 0],
  ['104', 'IVA Excluido 0%', 'IVA', 0],
  ['105', 'IVA No gravado 0%', 'IVA', 0],
  ['201', 'Honorarios 10% · Persona natural', 'Retefuente', 10],
  ['202', 'Honorarios 11% · Persona jurídica', 'Retefuente', 11],
  ['203', 'Honorarios 11% · P.N. casos especiales', 'Retefuente', 11],
  ['204', 'Comisiones 10% · Persona natural', 'Retefuente', 10],
  ['205', 'Comisiones 11% · Persona jurídica', 'Retefuente', 11],
  ['206', 'Comisiones 11% · P.N. casos especiales', 'Retefuente', 11],
  ['207', 'Servicios 4% · Declarante', 'Retefuente', 4],
  ['208', 'Servicios 6% · No declarante', 'Retefuente', 6],
  ['209', 'Compras 2,5% · Declarante', 'Retefuente', 2.5],
  ['210', 'Compras 3,5% · No declarante', 'Retefuente', 3.5],
  ['211', 'Arrendamiento de inmuebles 3,5%', 'Retefuente', 3.5],
  ['212', 'Arrendamiento de bienes muebles 4%', 'Retefuente', 4],
  ['213', 'Aseo y vigilancia 2%', 'Retefuente', 2],
  ['214', 'Servicios temporales 1%', 'Retefuente', 1],
  ['215', 'Otros ingresos 2,5% · Declarante', 'Retefuente', 2.5],
  ['216', 'Otros ingresos 3,5% · No declarante', 'Retefuente', 3.5],
  ['301', 'ReteIVA General 15%', 'ReteIVA', 15],
  ['401', 'ReteICA Bogotá 4,14 x 1.000', 'ReteICA', 4.14],
  ['402', 'ReteICA Bogotá 6,90 x 1.000', 'ReteICA', 6.9],
  ['403', 'ReteICA Bogotá 9,66 x 1.000', 'ReteICA', 9.66],
  ['404', 'ReteICA Bogotá 11,04 x 1.000', 'ReteICA', 11.04],
  ['405', 'ReteICA Bogotá 13,80 x 1.000', 'ReteICA', 13.8],
  ['406', 'ReteICA Bogotá Financiero 14 x 1.000', 'ReteICA', 14],
];

export const JARVIS_DEFAULT_TAXES = entries.map(([code, name, taxType, rate]) => ({
  code, name, taxType, rate: String(rate), isActive: true,
  category: taxType === 'IVA' ? JarvisTaxCategory.IMPUESTO : JarvisTaxCategory.RETENCION,
}));
