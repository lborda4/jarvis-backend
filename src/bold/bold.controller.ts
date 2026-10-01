import {
  Body,
  Controller,
  Get,
  Query,
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
import { ConfigService } from '@nestjs/config';
import { AppConfiguration } from '../config/configuration';
import { BoldCheckoutService } from './bold-checkout.service';

@Controller('bold')
export class BoldController {
  constructor(
    private readonly boldPaymentsService: BoldPaymentsService,
    private readonly boldTerminalsService: BoldTerminalsService,
    private readonly boldCashRegistersService: BoldCashRegistersService,
    private readonly boldCheckoutService: BoldCheckoutService,
    private readonly configService: ConfigService<AppConfiguration, true>,
  ) {}

  @Get('payments/payment-methods')
  getPaymentMethods(): Promise<BoldPaymentMethodsResponseDto> {
    return this.boldPaymentsService.getPaymentMethods();
  }

  /** Consulta Bold con la llave guardada de la empresa. */
  @UseGuards(AdminGuard)
  @Get('payments/binded-terminals')
  getBindedTerminals(
    @Query('companyId') companyId: string,
  ): Promise<BoldBindedTerminalsResponseDto> {
    return this.boldTerminalsService.getBindedTerminals(companyId);
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

  /** Recepción pública de la extensión para la primera empresa integrada.
   * Conserva la ruta existente; ahora solicita el cobro al datáfono Bold. */
  @Public()
  @Post('jarvis/test')
  async testJarvis(@Body() body: unknown) {
    console.log('[Bold] JSON recibido de la extensión:', JSON.stringify(body, null, 2));
    const { userEmail } = this.configService.get('bold', { infer: true });
    const result = await this.boldCheckoutService.createFromExtension(body, userEmail ?? '');
    return { success: true, message: 'Solicitud de cobro enviada a Bold.', ...result };
  }
}
