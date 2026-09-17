/** Impuestos y Retenciones viven en la MISMA tabla (jarvis_taxes); esta
 * categoría es lo único que distingue en cuál de las dos pestañas aparece
 * cada fila — se fija según desde qué pestaña el usuario le dio "Agregar
 * impuesto", no se deriva del campo libre `taxType` (que admite cualquier
 * texto, ver CreateJarvisTaxRequestDto). */
export enum JarvisTaxCategory {
  IMPUESTO = 'IMPUESTO',
  RETENCION = 'RETENCION',
}
