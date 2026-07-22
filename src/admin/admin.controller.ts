import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import {
  CreateAdminCompanyRequestDto,
  CreateAdminCompanyResponseDto,
  ListAdminCompaniesResponseDto,
  ListAdminPlansResponseDto,
} from './dto/admin-company.dto';
import { AdminGuard } from './guards/admin.guard';

@ApiTags('admin')
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('plans')
  @ApiOperation({
    summary: 'Listar planes',
    description: 'Lista los planes disponibles para asignar a empresas.',
  })
  listPlans(): Promise<ListAdminPlansResponseDto> {
    return this.adminService.listPlans();
  }

  @Get('companies')
  @ApiOperation({
    summary: 'Listar empresas',
    description:
      'Panel interno de administración. Lista empresas con sus integraciones y límites.',
  })
  listCompanies(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ListAdminCompaniesResponseDto> {
    return this.adminService.listCompanies(user.userId);
  }

  @Post('companies')
  @ApiOperation({
    summary: 'Crear empresa',
    description:
      'Crea una empresa por NIT, asigna un plan y configura integraciones SIIGO/Jarvis.',
  })
  createCompany(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: CreateAdminCompanyRequestDto,
  ): Promise<CreateAdminCompanyResponseDto> {
    return this.adminService.createCompany(request, user.userId);
  }
}
