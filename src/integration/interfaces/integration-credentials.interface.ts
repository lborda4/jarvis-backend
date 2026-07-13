export interface SiigoCredentials {
  username: string;
  access_key: string;
  partner_id?: string;
  token?: string;
  expires_at?: string;
}

export type IntegrationCredentials = SiigoCredentials;
