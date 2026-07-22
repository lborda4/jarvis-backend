import { BadGatewayException, Logger } from '@nestjs/common';

export function handleSiigoApiError(
  logger: Logger,
  error: unknown,
  action: string,
): never {
  const rawMessage =
    error instanceof Error
      ? error.message
      : `Error desconocido al ${action} en SIIGO`;

  const parsedDetail = parseSiigoErrorDetail(rawMessage);

  console.error('[SIIGO] error API', {
    action,
    rawMessage,
    parsedDetail,
    stack: error instanceof Error ? error.stack : undefined,
  });

  logger.error(
    `Error al ${action} en SIIGO: ${formatSiigoErrorMessage(parsedDetail, rawMessage)}`,
    error instanceof Error ? error.stack : String(error),
  );

  throw new BadGatewayException({
    message: `Error al ${action} en SIIGO`,
    code: extractSiigoErrorCode(parsedDetail),
    siigo: parsedDetail,
    detail: formatSiigoErrorMessage(parsedDetail, rawMessage),
  });
}

function extractSiigoErrorCode(
  parsedDetail: string | Record<string, unknown>,
): string | undefined {
  if (typeof parsedDetail !== 'object' || parsedDetail === null) {
    return undefined;
  }

  const errors = parsedDetail.Errors ?? parsedDetail.errors;

  if (!Array.isArray(errors) || errors.length === 0) {
    return undefined;
  }

  const firstError = errors[0] as Record<string, unknown> | undefined;
  const code = firstError?.Code ?? firstError?.code;

  return typeof code === 'string' && code.trim() ? code.trim() : undefined;
}

function formatSiigoErrorMessage(
  parsedDetail: string | Record<string, unknown>,
  fallback: string,
): string {
  if (typeof parsedDetail === 'string') {
    return parsedDetail;
  }

  return JSON.stringify(parsedDetail);
}

function parseSiigoErrorDetail(message: string): string | Record<string, unknown> {
  const jsonStart = message.indexOf('{');

  if (jsonStart === -1) {
    return message;
  }

  try {
    return JSON.parse(message.slice(jsonStart)) as Record<string, unknown>;
  } catch {
    return message;
  }
}
