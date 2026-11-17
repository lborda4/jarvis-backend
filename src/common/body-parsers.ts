import type { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';

export function configureBodyParsers(app: NestExpressApplication): void {
  // Los lotes de nómina necesitan límites mayores, solo en estas rutas.
  app.use('/integrations/jarvis/payroll/documents', json({ limit: '10mb' }));
  app.use('/integrations/jarvis/payroll/periods', json({ limit: '1mb' }));
  // Nest detecta jsonParser por nombre aunque esté limitado a una ruta.
  // Registrarlo explícitamente mantiene el JSON del resto de la API y rawBody
  // para verificar las firmas de webhooks cuando rawBody: true está activo.
  app.useBodyParser('json');
}
