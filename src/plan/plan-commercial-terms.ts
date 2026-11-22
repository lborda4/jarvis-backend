import type { JarvisModule } from '../company/jarvis-modules';

/** Commercial terms of a subscription. Top-ups are separate purchases. */
export interface PlanCommercialTerms {
  priceCop: number;
  billingMonths: number;
  employeeLimit: number | null;
  modules: JarvisModule[];
  includesDigitalCertificate: boolean;
  includesRadian: boolean;
}
