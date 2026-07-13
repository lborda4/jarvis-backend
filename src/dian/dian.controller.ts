import { Body, Controller, Post } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { getAuthenticatedCompanyId } from '../auth/helpers/authenticated-company.helper';
import { DianService } from './dian.service';
import { SearchDianRequestDto } from './dto/search-dian-request.dto';
import { SearchDianResponseDto } from './dto/search-dian-response.dto';

@Controller('dian')
export class DianController {
  constructor(private readonly dianService: DianService) {}

  @Post('search')
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: SearchDianRequestDto,
  ): Promise<SearchDianResponseDto> {
    return this.dianService.searchInvoices(
      request,
      getAuthenticatedCompanyId(user),
    );
  }
}
