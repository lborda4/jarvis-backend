export function stripBearerPrefix(token: string): string {
  return token.trim().replace(/^Bearer\s+/i, '');
}

export function formatAuthorizationHeader(
  token: string,
  tokenType = 'Bearer',
): string {
  const normalizedToken = stripBearerPrefix(token);

  if (!normalizedToken) {
    return '';
  }

  return `${tokenType} ${normalizedToken}`;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function isSiigoUnauthorizedError(error: unknown): boolean {
  const message = extractErrorMessage(error).toLowerCase();

  return (
    message.includes('estado 401') ||
    message.includes('"status":401') ||
    message.includes('"code":"unauthorized"') ||
    message.includes('verify the authorization header')
  );
}

export function isSiigoRateLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes('estado 429') ||
    error.message.includes('"Code":"requests_limit"')
  );
}

/** 503 transitorio del lado de SIIGO (ej. "document_query_service" caído
 * unos minutos) — no es un error nuestro, vale la pena reintentar unas
 * pocas veces antes de darlo por perdido. */
export function isSiigoServiceUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes('estado 503') ||
    message.includes('"status":503') ||
    message.includes('document_query_service')
  );
}

export function isSiigoSupportDocumentNumberAlreadyExistsError(
  error: unknown,
): boolean {
  const message = extractErrorMessage(error);

  if (
    !message.includes('estado 400') &&
    !message.includes('"Status":400') &&
    !message.includes('"status":400')
  ) {
    return false;
  }

  const hasAlreadyExistsCode =
    message.includes('"Code":"already_exists"') ||
    message.includes('"code":"already_exists"');

  const referencesDocumentNumber =
    message.includes('"Params":["number"]') ||
    message.includes('"params":["number"]') ||
    message.includes('The number already exists');

  return hasAlreadyExistsCode && referencesDocumentNumber;
}

export function isSiigoDuplicatedDocumentError(error: unknown): boolean {
  const message = extractErrorMessage(error).toLowerCase();

  return (
    message.includes('duplicated_document') ||
    message.includes('duplicate requests') ||
    message.includes('duplicate request') ||
    message.includes('the document already exists')
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
