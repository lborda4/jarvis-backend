export interface BoldWebhookAmount {
  currency?: string;
  total?: number;
  taxes?: Array<{ base?: number; type?: string; value?: number }>;
  tip?: number;
}

export interface BoldWebhookCard {
  capture_mode?: string;
  brand?: string;
  franchise?: string;
  cardholder_name?: string;
  terminal_id?: string;
  masked_pan?: string;
  installments?: number;
  card_type?: string;
}

export interface BoldWebhookNotificationData {
  payment_id?: string;
  merchant_id?: string;
  created_at?: string;
  amount?: BoldWebhookAmount;
  metadata?: { reference?: string | null };
  bold_code?: string;
  payment_method?: string;
  approval_number?: string;
  integration?: string;
  user_id?: string;
  payer_email?: string;
  card?: BoldWebhookCard;
}

/** CloudEvent que Bold POST al endpoint registrado en el panel. */
export interface BoldWebhookNotification {
  id?: string;
  type?: string;
  subject?: string;
  source?: string;
  spec_version?: string;
  time?: number;
  data?: BoldWebhookNotificationData;
  datacontenttype?: string;
  seller?: { name?: string; last_name?: string; email?: string };
}
