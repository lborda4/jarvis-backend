import { Logger } from '@nestjs/common';
import {
  isSiigoRateLimitError,
  isSiigoUnauthorizedError,
  sleep,
} from './siigo-auth.helper';
import { handleSiigoApiError } from './siigo-error.helper';
import { SiigoAuthService } from '../siigo-auth.service';
import { SiigoAuthContext } from '../interfaces/siigo-auth-context.interface';

const MAX_UNAUTHORIZED_RETRIES = 2;

export async function executeSiigoRequestWithRetries<T>(
  authService: SiigoAuthService,
  companyId: string,
  logger: Logger,
  operationLabel: string,
  request: (
    accessToken: string,
    partnerId: string | undefined,
  ) => Promise<T>,
  attempt = 0,
  authContextOverride?: SiigoAuthContext,
): Promise<T> {
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
        attempt + 1,
        authContext,
      );
    }

    handleSiigoApiError(logger, error, operationLabel);
  }
}
