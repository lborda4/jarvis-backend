import { parseDianValidationResult } from './nextpyme-dian-validation.helper';
import { collectRecords } from './nextpyme-record-scan.helper';

export interface RadianEventResult {
  status: 'sent' | 'failed' | 'unknown';
  cude?: string;
  dianCode?: string;
  message?: string;
  response?: unknown;
}

export function parseRadianEventResult(
  response: unknown,
  httpStatus: number,
): RadianEventResult {
  const body =
    response && typeof response === 'object'
      ? (response as Record<string, unknown>)
      : {};
  const validation = parseDianValidationResult(response);
  const documentKey =
    typeof body.cude === 'string'
      ? body.cude
      : collectRecords(body.ResponseDian).find(
          (record) => typeof record.XmlDocumentKey === 'string',
        )?.XmlDocumentKey;
  const duplicate =
    body.success === false &&
    typeof body.message === 'string' &&
    /ya se registr[oó]/i.test(body.message);
  const status: RadianEventResult['status'] =
    httpStatus >= 500 || duplicate
      ? 'unknown'
      : httpStatus < 200 ||
          httpStatus >= 300 ||
          body.success === false ||
          validation?.isValid === false
        ? 'failed'
        : validation?.isValid === true &&
            (validation.statusCode == null || validation.statusCode === '00')
          ? 'sent'
          : 'unknown';
  return {
    status,
    ...(typeof documentKey === 'string' && documentKey.trim()
      ? { cude: documentKey.trim() }
      : {}),
    ...(validation?.statusCode ? { dianCode: validation.statusCode } : {}),
    ...(validation?.errorMessage || validation?.statusMessage || body.message
      ? {
          message: String(
            validation?.errorMessage ||
              validation?.statusMessage ||
              body.message,
          ),
        }
      : {}),
    response,
  };
}
