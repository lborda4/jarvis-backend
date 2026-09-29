import {
  AiSuggestionItemSnapshot,
  AiSuggestionSnapshot,
  ElectronicDocumentPayload,
} from '../interfaces/electronic-document-payload.interface';

type AiPayload = Pick<ElectronicDocumentPayload, 'items' | 'aiSuggestion'>;

/** Compatibility with stored documents from before suggestions lived on each item. */
export function resolveItemAiSuggestion(
  payload: AiPayload,
  index: number,
): AiSuggestionItemSnapshot | null | undefined {
  const item = payload.items?.[index];
  if (item?.aiSuggestion !== undefined) return item.aiSuggestion;
  if (payload.aiSuggestion?.items !== undefined)
    return payload.aiSuggestion.items[index];
  return payload.aiSuggestion;
}

/** Derived for API summaries only; never persisted as a second suggestion. */
export function summarizeDocumentAiSuggestion(
  payload: AiPayload | null | undefined,
): AiSuggestionSnapshot | null {
  if (!payload) return null;
  const items = payload.items ?? [];
  const root = payload.aiSuggestion;
  if (!items.some((item) => item.aiSuggestion !== undefined) &&
      root?.costsByRequest && root.confidence == null && !root.account &&
      !root.product && !root.itemType && !root.items) return null;
  if (!items.some((item) => item.aiSuggestion !== undefined))
    return payload.aiSuggestion ?? null;
  const suggestions = items.map((_, index) =>
    resolveItemAiSuggestion(payload, index),
  );
  const unanimous = (key: 'account' | 'product') => {
    const first = suggestions[0]?.[key];
    return first &&
      suggestions.every((suggestion) => suggestion?.[key]?.code === first.code)
      ? first
      : null;
  };
  const firstType = items[0]?.itemType;
  return {
    itemType:
      (firstType === 'Account' || firstType === 'Product') &&
      items.every((item) => item.itemType === firstType)
        ? firstType
        : null,
    account: unanimous('account'),
    product: unanimous('product'),
    confidence: suggestions.some((suggestion) => suggestion?.confidence == null)
      ? null
      : Math.min(...suggestions.map((suggestion) => suggestion!.confidence!)),
    retentions: [],
  };
}
