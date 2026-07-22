export const SIIGO_CONFIGURATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const SIIGO_COST_CENTERS_CACHE_TTL_MS = 1000;

export const SIIGO_CONFIGURATION_CACHE_LOG = {
  USING_STORED: '[SIIGO CONFIG] Utilizando caché en memoria',
  USING_STORED_SUPPORT_DOCUMENT_TYPE:
    '[SIIGO CONFIG] Utilizando id de documento soporte desde caché en memoria',
  USING_STORED_PURCHASE_DOCUMENT_TYPE:
    '[SIIGO CONFIG] Utilizando id de factura de compra desde caché en memoria',
  EXPIRED_SYNCING:
    '[SIIGO CONFIG] Caché expirada. Consultando SIIGO...',
  UPDATED: '[SIIGO CONFIG] Caché actualizada correctamente',
} as const;
