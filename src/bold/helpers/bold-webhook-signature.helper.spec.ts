import {
  computeBoldWebhookSignature,
  hashBoldWebhookRawBody,
  isBoldWebhookSignatureValid,
  readBoldSignatureHeader,
} from './bold-webhook-signature.helper';

const BODY = '{"id":"abc","type":"SALE_APPROVED"}';
const SECRET = 'test-secret';
const EXPECTED =
  '5a016b6a1e0025d981be2e03ace60f236401402a72b11d256a8e1f39349f56fc';
const EMPTY_SECRET_EXPECTED =
  '7f0e550c9c47ac1693f67691de96b5bc82c96940abe6ea7a76c98814f6f88863';

describe('bold webhook signature', () => {
  it('HMAC-SHA256 of base64(body) with the secret key', () => {
    expect(computeBoldWebhookSignature(BODY, SECRET)).toBe(EXPECTED);
    expect(computeBoldWebhookSignature(Buffer.from(BODY), SECRET)).toBe(
      EXPECTED,
    );
  });

  it('accepts the header when it matches the secret', () => {
    expect(isBoldWebhookSignatureValid(BODY, SECRET, EXPECTED)).toBe(true);
  });

  it('rejects a different secret or a truncated header', () => {
    expect(isBoldWebhookSignatureValid(BODY, 'other-secret', EXPECTED)).toBe(
      false,
    );
    expect(isBoldWebhookSignatureValid(BODY, SECRET, EXPECTED.slice(0, 8))).toBe(
      false,
    );
  });

  it('uses an empty secret in Bold test mode', () => {
    expect(computeBoldWebhookSignature(BODY, '')).toBe(EMPTY_SECRET_EXPECTED);
    expect(isBoldWebhookSignatureValid(BODY, '', EMPTY_SECRET_EXPECTED)).toBe(
      true,
    );
  });

  it('reads the first x-bold-signature value', () => {
    expect(readBoldSignatureHeader('  abc  ')).toBe('abc');
    expect(readBoldSignatureHeader(['first', 'second'])).toBe('first');
    expect(readBoldSignatureHeader(undefined)).toBe('');
  });

  it('hashes the raw body for idempotency without a notification id', () => {
    expect(hashBoldWebhookRawBody(BODY)).toHaveLength(64);
    expect(hashBoldWebhookRawBody(BODY)).toBe(hashBoldWebhookRawBody(BODY));
  });
});
