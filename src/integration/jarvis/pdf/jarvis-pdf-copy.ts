export function jarvisPdfCopy(kind?: string | null) {
  switch (kind) {
    case 'SUPPORT_DOCUMENT':
      return {
        title: 'Documento Soporte\nElectrónico',
        shortTitle: 'Documento soporte',
        party: 'Proveedor',
        uniqueCode: 'CUDS',
        footer: 'documento soporte electrónico',
        related: 'Documento relacionado',
      };
    case 'CREDIT_NOTE':
      return {
        title: 'Nota Crédito',
        shortTitle: 'Nota crédito',
        party: 'Cliente',
        uniqueCode: 'CUDE',
        footer: 'nota crédito',
        related: 'Factura relacionada',
      };
    case 'DEBIT_NOTE':
      return {
        title: 'Nota Débito',
        shortTitle: 'Nota débito',
        party: 'Cliente',
        uniqueCode: 'CUDE',
        footer: 'nota débito',
        related: 'Factura relacionada',
      };
    case 'SUPPORT_CREDIT_NOTE':
      return {
        title: 'Nota de Ajuste',
        shortTitle: 'Nota de ajuste',
        party: 'Proveedor',
        uniqueCode: 'CUDS',
        footer: 'nota de ajuste al documento soporte electrónico',
        related: 'Documento relacionado',
      };
    default:
      return {
        title: 'Factura Electrónica\nde Venta',
        shortTitle: 'Factura',
        party: 'Cliente',
        uniqueCode: 'CUFE',
        footer: 'factura electrónica de venta',
        related: 'Factura relacionada',
      };
  }
}
