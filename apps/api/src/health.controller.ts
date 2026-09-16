import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Database } from './database.js';
import { ApiError } from './http.js';
import { Public } from './auth/metadata.js';

class HealthResponse {
  @ApiProperty({ enum: ['ok'] }) status!: 'ok';
}

@ApiTags('health')
@Public()
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  @ApiOkResponse({
    type: HealthResponse,
    description: 'Process is alive (does not check database)',
  })
  live(): HealthResponse {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOkResponse({ type: HealthResponse })
  @ApiServiceUnavailableResponse({ type: ApiError })
  async ready(): Promise<HealthResponse> {
    try {
      await this.database.ping();
    } catch {
      throw new ServiceUnavailableException();
    }
    return { status: 'ok' };
  }
}
