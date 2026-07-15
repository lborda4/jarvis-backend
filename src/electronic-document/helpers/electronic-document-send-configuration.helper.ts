import { normalizeSupplierPreferenceSnapshot } from '../../integration/helpers/supplier-preference.helper';
import { SupplierPreferenceSnapshot } from '../../integration/interfaces/supplier-preference.interface';
import { ElectronicDocumentPayload } from '../interfaces/electronic-document-payload.interface';

export function resolveSendConfigurationFromPayload(
  payload: Pick<ElectronicDocumentPayload, 'siigoSendConfiguration'> | null | undefined,
): SupplierPreferenceSnapshot | null {
  return normalizeSupplierPreferenceSnapshot(payload?.siigoSendConfiguration);
}
