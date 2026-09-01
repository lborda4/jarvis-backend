/** SIIGO rechaza /v1/purchases y /v1/support-documents-inbound con
 * `length_max` si `observations` supera los 1000 caracteres — algunas
 * facturas DIAN (ej. operadores con boilerplate legal de autorretención ICA
 * municipio por municipio) traen observaciones de varios miles de
 * caracteres. Se trunca en vez de dejar que SIIGO rechace toda la factura
 * por un campo que no afecta la contabilización. */
export const SIIGO_OBSERVATIONS_MAX_LENGTH = 1000;
const TRUNCATION_SUFFIX = '...';

export function truncateSiigoObservations(text: string): string {
  if (text.length <= SIIGO_OBSERVATIONS_MAX_LENGTH) {
    return text;
  }

  return (
    text.slice(0, SIIGO_OBSERVATIONS_MAX_LENGTH - TRUNCATION_SUFFIX.length) +
    TRUNCATION_SUFFIX
  );
}
