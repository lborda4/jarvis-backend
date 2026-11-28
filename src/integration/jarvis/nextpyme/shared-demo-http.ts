import type { HttpService } from '@nestjs/axios';
import { ServiceUnavailableException } from '@nestjs/common';
import { SHARED_DEMO_TOKEN } from '../../../advisor/shared-demo.constants';
import type { SharedDemoTransport } from './shared-demo-transport';

const installed = new WeakSet<object>();
export function installSharedDemoTransport(
  http: HttpService,
  demo?: SharedDemoTransport,
) {
  const client = http.axiosRef;
  if (!client || installed.has(client)) return;
  installed.add(client);
  client.interceptors.request.use((config) => {
    if (config.headers.get('Authorization') === `Bearer ${SHARED_DEMO_TOKEN}`) {
      // Install a closed adapter even if DI is incomplete: the internal marker must never leave the server.
      config.adapter = async (request) => {
        if (!demo)
          throw new ServiceUnavailableException(
            'El transporte demo no está disponible.',
          );
        return demo.respond(request);
      };
    }
    return config;
  });
}
