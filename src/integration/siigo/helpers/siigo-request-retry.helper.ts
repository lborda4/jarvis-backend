import { Logger } from '@nestjs/common';
import {
  isSiigoDuplicatedDocumentError,
  isSiigoRateLimitError,
  isSiigoServiceUnavailableError,
  isSiigoSupportDocumentNumberAlreadyExistsError,
  isSiigoUnauthorizedError,
  sleep,
} from './siigo-auth.helper';
import { handleSiigoApiError } from './siigo-error.helper';
import { SiigoAuthService } from '../siigo-auth.service';
import { SiigoAuthContext } from '../interfaces/siigo-auth-context.interface';

const MAX_UNAUTHORIZED_RETRIES = 2;
/** 429 (rate limit): backoff exponencial con techo, no un delay fijo — cada
 * reintento espera el doble que el anterior (1s, 2s, 4s, 8s) hasta el techo,
 * para no seguir golpeando a SIIGO al mismo ritmo que causó el 429. */
const MAX_RATE_LIMIT_RETRIES = 4;
const RATE_LIMIT_BASE_DELAY_MS = 1000;
const RATE_LIMIT_MAX_DELAY_MS = 16000;
const MAX_SERVICE_UNAVAILABLE_RETRIES = 2;
const SERVICE_UNAVAILABLE_RETRY_DELAY_MS = 3000;
const MAX_SUPPORT_DOCUMENT_NUMBER_RETRIES = 1;
const SUPPORT_DOCUMENT_NUMBER_RETRY_DELAY_MS = 3000;
const DEFAULT_DUPLICATED_DOCUMENT_RETRIES = 2;
const DEFAULT_DUPLICATED_DOCUMENT_RETRY_DELAY_MS = 5000;

export interface ExecuteSiigoRequestRetryOptions {
  maxGenericRetries?: number;
  genericRetryDelayMs?: number;
  maxDuplicatedDocumentRetries?: number;
  duplicatedDocumentRetryDelayMs?: number;
}

export async function executeSiigoRequestWithRetries<T>(
  authService: SiigoAuthService,
  companyId: string,
  logger: Logger,
  operationLabel: string,
  request: (
    accessToken: string,
    partnerId: string | undefined,
  ) => Promise<T>,
  options: ExecuteSiigoRequestRetryOptions = {},
  attempt = 0,
  authContextOverride?: SiigoAuthContext,
): Promise<T> {
  const maxGenericRetries = options.maxGenericRetries ?? 0;
  const genericRetryDelayMs = options.genericRetryDelayMs ?? 1000;
  const maxDuplicatedDocumentRetries =
    options.maxDuplicatedDocumentRetries ?? DEFAULT_DUPLICATED_DOCUMENT_RETRIES;
  const duplicatedDocumentRetryDelayMs =
    options.duplicatedDocumentRetryDelayMs ??
    DEFAULT_DUPLICATED_DOCUMENT_RETRY_DELAY_MS;
  const authContext =
    authContextOverride ?? (await authService.getValidAuthContext(companyId));

  try {
    return await request(authContext.accessToken, authContext.partnerId);
  } catch (error) {
    if (isSiigoUnauthorizedError(error) && attempt < MAX_UNAUTHORIZED_RETRIES) {
      logger.warn(
        `[companyId=${companyId}] Token SIIGO inválido o expirado al ${operationLabel}. Renovando automáticamente (intento ${attempt + 1}).`,
      );

      const refreshedContext =
        await authService.forceRefreshAuthContext(companyId);

      return executeSiigoRequestWithRetries(
        authService,
        companyId,
        logger,
        operationLabel,
        request,
        options,
        attempt + 1,
        refreshedContext,
      );
    }

    if (isSiigoRateLimitError(error) && attempt < MAX_RATE_LIMIT_RETRIES) {
      const delayMs = Math.min(
        RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt,
        RATE_LIMIT_MAX_DELAY_MS,
      );

      logger.warn(
        `[companyId=${companyId}] SIIGO respondió 429 (rate limit) al ${operationLabel}. Reintentando en ${delayMs}ms (intento ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES}).`,
      );

      await sleep(delayMs);

      return executeSiigoRequestWithRetries(
        authService,
        companyId,
        logger,
        operationLabel,
        request,
        options,
        attempt + 1,
        authContext,
      );
    }

    if (
      isSiigoServiceUnavailableError(error) &&
      attempt < MAX_SERVICE_UNAVAILABLE_RETRIES
    ) {
      logger.warn(
        `[companyId=${companyId}] SIIGO respondió 503 (servicio no disponible) al ${operationLabel}. Reintentando en ${SERVICE_UNAVAILABLE_RETRY_DELAY_MS}ms (intento ${attempt + 1}/${MAX_SERVICE_UNAVAILABLE_RETRIES}).`,
      );

      await sleep(SERVICE_UNAVAILABLE_RETRY_DELAY_MS);

      return executeSiigoRequestWithRetries(
        authService,
        companyId,
        logger,
        operationLabel,
        request,
        options,
        attempt + 1,
        authContext,
      );
    }

    if (
      isSiigoSupportDocumentNumberAlreadyExistsError(error) &&
      attempt < MAX_SUPPORT_DOCUMENT_NUMBER_RETRIES
    ) {
      logger.warn(
        `[companyId=${companyId}] SIIGO reportó que el número del Documento Soporte ya existe al ${operationLabel}. Reenviando la misma solicitud en ${SUPPORT_DOCUMENT_NUMBER_RETRY_DELAY_MS}ms (intento ${attempt + 1}).`,
      );

      await sleep(SUPPORT_DOCUMENT_NUMBER_RETRY_DELAY_MS);

      return executeSiigoRequestWithRetries(
        authService,
        companyId,
        logger,
        operationLabel,
        request,
        options,
        attempt + 1,
        authContext,
      );
    }

    if (
      isSiigoDuplicatedDocumentError(error) &&
      attempt < maxDuplicatedDocumentRetries
    ) {
      logger.warn(
        `[companyId=${companyId}] SIIGO respondió duplicated_document al ${operationLabel}. Esperando ${duplicatedDocumentRetryDelayMs}ms y reintentando (intento ${attempt + 1}/${maxDuplicatedDocumentRetries}).`,
      );

      await sleep(duplicatedDocumentRetryDelayMs);

      return executeSiigoRequestWithRetries(
        authService,
        companyId,
        logger,
        operationLabel,
        request,
        options,
        attempt + 1,
        authContext,
      );
    }

    if (attempt < maxGenericRetries) {
      logger.warn(
        `[companyId=${companyId}] Error al ${operationLabel}. Reintentando en ${genericRetryDelayMs}ms (${attempt + 1}/${maxGenericRetries}).`,
      );

      await sleep(genericRetryDelayMs);

      return executeSiigoRequestWithRetries(
        authService,
        companyId,
        logger,
        operationLabel,
        request,
        options,
        attempt + 1,
        authContext,
      );
    }

    handleSiigoApiError(logger, error, operationLabel);
  }
}
