import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { AdminGuard } from '../admin/guards/admin.guard';
import { BoldCashRegistersService } from './bold-cash-registers.service';
import { BoldPaymentsService } from './bold-payments.service';
import { BoldTerminalsService } from './bold-terminals.service';
import {
  BoldCashRegisterDto,
  ListBoldCashRegistersResponseDto,
  UpsertBoldCashRegisterRequestDto,
  UpsertBoldCashRegisterResponseDto,
} from './dto/bold-cash-register.dto';
import { BoldPaymentMethodsResponseDto } from './dto/bold-payment-methods.dto';
import { BoldBindedTerminalsResponseDto } from './dto/bold-terminals.dto';

@Controller('bold')
export class BoldController {
  constructor(
    private readonly boldPaymentsService: BoldPaymentsService,
    private readonly boldTerminalsService: BoldTerminalsService,
    private readonly boldCashRegistersService: BoldCashRegistersService,
  ) {}

  @Get('payments/payment-methods')
  getPaymentMethods(): Promise<BoldPaymentMethodsResponseDto> {
    return this.boldPaymentsService.getPaymentMethods();
  }

  /**
   * Datáfonos vinculados a la cuenta Bold de una empresa — solo panel de
   * admin por ahora. La llave de identidad (x-api-key) no está persistida
   * todavía (ver ensureBoldIntegration), así que viaja en cada llamada
   * desde el frontend en este header en vez de resolverse del lado del
   * servidor.
   */
  @UseGuards(AdminGuard)
  @Get('payments/binded-terminals')
  getBindedTerminals(
    @Headers('x-bold-api-key') apiKey?: string,
  ): Promise<BoldBindedTerminalsResponseDto> {
    return this.boldTerminalsService.getBindedTerminals(apiKey);
  }

  /** Cajas SIIGO ya mapeadas a un datáfono Bold para esta empresa — mismos
   * registros que después consumirá la extensión de Chrome, ver
   * SiigoBoldCashRegister. */
  @UseGuards(AdminGuard)
  @Get('cash-registers/:companyId')
  async listCashRegisters(
    @Param('companyId') companyId: string,
  ): Promise<ListBoldCashRegistersResponseDto> {
    const items = await this.boldCashRegistersService.listByCompany(companyId);

    return { items };
  }

  /** Crea o actualiza (por sucursal + id de caja) el mapeo caja↔datáfono —
   * el admin la llena a mano desde el panel; la extensión de Chrome hará lo
   * mismo automáticamente más adelante, sobre la misma tabla. */
  @UseGuards(AdminGuard)
  @Post('cash-registers')
  async upsertCashRegister(
    @Body() request: UpsertBoldCashRegisterRequestDto,
  ): Promise<UpsertBoldCashRegisterResponseDto> {
    const item: BoldCashRegisterDto =
      await this.boldCashRegistersService.upsert(request);

    return { item };
  }

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
