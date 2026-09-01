import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';

/**
 * El decorador @WebSocketGateway no puede inyectar ConfigService (sus
 * opciones se evalúan al definir la clase, no en runtime), así que el CORS
 * del servidor de socket.io se aplica acá, en el único lugar donde ya
 * tenemos el ConfigService resuelto (main.ts) — misma lista de orígenes que
 * usa app.enableCors() para el resto de la API.
 */
export class SocketIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly corsOrigins: string[],
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.corsOrigins, credentials: true },
    });
  }
}
