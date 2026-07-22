import { Logger } from '@nestjs/common';
import {
  isSiigoDuplicatedDocumentError,
  isSiigoRateLimitError,
  isSiigoSupportDocumentNumberAlreadyExistsError,
  isSiigoUnauthorizedError,
  sleep,
} from './siigo-auth.helper';
import { handleSiigoApiError } from './siigo-error.helper';
import { SiigoAuthService } from '../siigo-auth.service';
import { SiigoAuthContext } from '../interfaces/siigo-auth-context.interface';

const MAX_UNAUTHORIZED_RETRIES = 2;
const MAX_SUPPORT_DOCUMENT_NUMBER_RETRIES = 1;
const SUPPORT_DOCUMENT_NUMBER_RETRY_DELAY_MS = 3000;

export interface ExecuteSiigoRequestRetryOptions {
  maxGenericRetries?: number;
  genericRetryDelayMs?: number;
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

    if (isSiigoRateLimitError(error) && attempt < 2) {
      await sleep(1500);

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

    if (isSiigoDuplicatedDocumentError(error)) {
      handleSiigoApiError(logger, error, operationLabel);
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
