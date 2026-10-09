import { createHmac, createHash, timingSafeEqual } from 'crypto';

/**
 * Firma HMAC-SHA256 que Bold pone en `x-bold-signature`.
 * Cuerpo crudo → Base64 → HMAC-SHA256(llave_secreta) en hex.
 * https://developers.bold.co/webhook
 */
export function computeBoldWebhookSignature(
  rawBody: Buffer | string,
  secretKey: string,
): string {
  const encodedBody = Buffer.from(rawBody).toString('base64');
  return createHmac('sha256', secretKey).update(encodedBody).digest('hex');
}

export function boldWebhookSignaturesMatch(
  expectedHex: string,
  received: string,
): boolean {
  const expected = Buffer.from(expectedHex);
  const receivedBuffer = Buffer.from(received);
  if (expected.length === 0 || expected.length !== receivedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expected, receivedBuffer);
}

export function isBoldWebhookSignatureValid(
  rawBody: Buffer | string,
  secretKey: string,
  receivedSignature: string,
): boolean {
  return boldWebhookSignaturesMatch(
    computeBoldWebhookSignature(rawBody, secretKey),
    receivedSignature,
  );
}

/** Huella estable del cuerpo cuando Bold no manda `id` — idempotencia de reintentos. */
export function hashBoldWebhookRawBody(rawBody: Buffer | string): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

export function readBoldSignatureHeader(
  value: string | string[] | undefined,
): string {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0].trim() : '';
  }
  return typeof value === 'string' ? value.trim() : '';
}
