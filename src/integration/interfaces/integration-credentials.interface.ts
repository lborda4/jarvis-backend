export interface SiigoCredentials {
  username: string;
  access_key: string;
  partner_id?: string;
  token?: string;
  expires_at?: string;
}

import { JarvisEntityType } from '../jarvis/enums/jarvis-entity-type.enum';
import { JarvisTaxRegime } from '../jarvis/enums/jarvis-tax-regime.enum';

export interface JarvisCredentials {
  business_name?: string;
  economic_activity?: string;
  entity_type?: JarvisEntityType;
  tax_regime?: JarvisTaxRegime;
  configured_at?: string;
}

export type IntegrationCredentials = SiigoCredentials | JarvisCredentials;
