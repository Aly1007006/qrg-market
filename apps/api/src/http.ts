import { randomUUID } from 'node:crypto';
import {
  Catch,
  HttpException,
  Logger,
  NotFoundException,
  ValidationPipe,
  VersioningType,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiProperty, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import type { AppConfig } from './config.js';
import { sessionCookieName } from './auth/tokens.js';
import { adminCookieName } from './admin/security.js';

export class ApiError {
  @ApiProperty({ example: 400 }) statusCode!: number;
  @ApiProperty({ example: 'BAD_REQUEST' }) code!: string;
  @ApiProperty({ example: 'Invalid request' }) message!: string;
  @ApiProperty({ format: 'uuid' }) requestId!: string;
  @ApiProperty({ format: 'date-time' }) timestamp!: string;
}

const errors: Record<number, [string, string]> = {
  400: ['BAD_REQUEST', 'Invalid request'],
  401: ['UNAUTHORIZED', 'Authentication required'],
  403: ['FORBIDDEN', 'Access denied'],
  404: ['NOT_FOUND', 'Resource not found'],
  405: ['METHOD_NOT_ALLOWED', 'Method not allowed'],
  409: ['CONFLICT', 'Resource conflict'],
  413: ['PAYLOAD_TOO_LARGE', 'Request payload too large'],
  415: ['UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type'],
  429: ['TOO_MANY_REQUESTS', 'Too many requests'],
  503: ['SERVICE_UNAVAILABLE', 'Service temporarily unavailable'],
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    this.reply(exception, response);
  }

  reply(exception: unknown, response: Response): void {
    let status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    // Express body parser errors occur before controllers and must use the same envelope.
    if (exception instanceof Error && 'type' in exception) {
      if (exception.type === 'entity.too.large') status = 413;
      if (exception.type === 'entity.parse.failed') status = 400;
      if (
        exception.type === 'encoding.unsupported' ||
        exception.type === 'charset.unsupported'
      )
        status = 415;
    }
    if (status < 400 || status > 599) status = 500;
    if (status === 429) response.setHeader('retry-after', '900');
    const [code, message] = errors[status] ?? [
      'INTERNAL_SERVER_ERROR',
      'Internal server error',
    ];
    const requestId = String(
      response.getHeader('x-request-id') ?? randomUUID(),
    );
    if (status >= 500) {
      this.logger.error({
        event: 'request_failed',
        request_id: requestId,
        status_code: status,
      });
    }
    if (!response.headersSent) {
      response.status(status).json({
        statusCode: status,
        code,
        message,
        requestId,
        timestamp: new Date().toISOString(),
      } satisfies ApiError);
    }
  }
}

export async function configureApplication(
  app: NestExpressApplication,
  config: AppConfig,
): Promise<void> {
  const logger = new Logger('HTTP');
  app.disable('x-powered-by');
  app.use((request: Request, response: Response, next: NextFunction) => {
    const requestId = randomUUID();
    const started = performance.now();
    response.setHeader('x-request-id', requestId);
    response.setHeader('cache-control', 'no-store');
    response.on('finish', () => {
      // Deliberately exclude URL/query, headers, body and IP: all may contain personal data.
      logger.log({
        event: 'http_request',
        request_id: requestId,
        method: request.method,
        status_code: response.statusCode,
        duration_ms: Math.round(performance.now() - started),
      });
    });
    next();
  });
  app.use(helmet());
  app.use(
    '/api/v1/public/requests',
    json({ limit: '8kb', strict: true, inflate: false }),
  );
  app.use(json({ limit: '32kb', strict: true }));
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      validationError: { target: false, value: false },
    }),
  );
  const exceptionFilter = new ApiExceptionFilter();
  app.useGlobalFilters(exceptionFilter);
  if (config.swaggerEnabled) {
    const options = new DocumentBuilder()
      .setTitle('QRG MARKET API')
      .setDescription(
        'Private seller API. Mutations require trusted Origin, X-QRG-Client: web and JSON. Authenticated mutations also require X-QRG-CSRF from login/me. Roles are resolved through shop_members.',
      )
      .addCookieAuth(
        sessionCookieName(config),
        { type: 'apiKey', in: 'cookie' },
        'seller-session',
      )
      .setVersion('1')
      .addCookieAuth(
        adminCookieName(config),
        { type: 'apiKey', in: 'cookie' },
        'admin-session',
      )
      .build();
    const document = SwaggerModule.createDocument(app, options);
    SwaggerModule.setup('api/docs', app, document, {
      jsonDocumentUrl: 'api/openapi.json',
    });
  }
  await app.init();
  // This API owns its HTTP server. Cover unmatched URLs outside Nest's global prefix too.
  app.use((_request: Request, response: Response) => {
    exceptionFilter.reply(new NotFoundException(), response);
  });
}
