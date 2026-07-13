export const SIIGO_CONFIGURATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const SIIGO_CONFIGURATION_CACHE_LOG = {
  USING_STORED: '[SIIGO CONFIG] Utilizando configuración almacenada',
  USING_STORED_SUPPORT_DOCUMENT_TYPE:
    '[SIIGO CONFIG] Utilizando id de documento soporte almacenado',
  USING_STORED_PURCHASE_DOCUMENT_TYPE:
    '[SIIGO CONFIG] Utilizando id de factura de compra almacenado',
  EXPIRED_SYNCING:
    '[SIIGO CONFIG] Configuración expirada. Sincronizando con SIIGO...',
  UPDATED: '[SIIGO CONFIG] Configuración actualizada correctamente',
} as const;
