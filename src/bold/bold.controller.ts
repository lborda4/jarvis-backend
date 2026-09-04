import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';

@Controller('bold')
export class BoldController {
  /**
   * Endpoint de prueba para confirmar que la extensión de Chrome (content
   * script en Siigo POS) puede llegar hasta este backend — sin esto, no
   * hay forma de distinguir "el backend no responde" de "el content
   * script nunca llegó a intentar el fetch". @Public() porque quien llama
   * es la extensión, no un usuario logueado en JARVIS con JWT.
   */
  @Public()
  @Post('jarvis/test')
  testJarvis(@Body() body: unknown) {
    console.log('🤖 JARVIS recibió:', body);

    return {
      success: true,
      received: body,
    };
  }
}
