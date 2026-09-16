import 'reflect-metadata';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IsString, Length } from 'class-validator';
import { AppModule } from '../src/app.module.js';
import { loadConfig } from '../src/config.js';
import { configureApplication } from '../src/http.js';
import { Public } from '../src/auth/metadata.js';

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:local-only@127.0.0.1:1/unavailable',
  SWAGGER_ENABLED: 'true',
});
class ProbeDto {
  @IsString() @Length(1, 20) name!: string;
}
// Test-only routes verify shared infrastructure; these are never in AppModule.
@Controller({ path: 'probe', version: '1' })
@Public()
class ProbeController {
  @Post() create(@Body() body: ProbeDto): ProbeDto {
    return body;
  }
  @Get('failure') fail(): never {
    throw new Error('private database password');
  }
}
@Module({
  imports: [AppModule.register(config)],
  controllers: [ProbeController],
})
class TestModule {}

let app: NestExpressApplication;
let base: string;
before(async () => {
  app = await NestFactory.create<NestExpressApplication>(TestModule, {
    logger: false,
    bodyParser: false,
  });
  await configureApplication(app, config);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
after(async () => {
  await app.close();
});

async function assertError(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  assert.equal(response.status, status);
  const raw = await response.text();
  assert.match(
    response.headers.get('content-type') ?? '',
    /application\/json/,
    raw,
  );
  const body: unknown = JSON.parse(raw);
  assert.ok(body !== null && typeof body === 'object');
  assert.ok('requestId' in body && typeof body.requestId === 'string');
  assert.match(body.requestId, /^[a-f0-9-]{36}$/);
  assert.equal(response.headers.get('x-request-id'), body.requestId);
  assert.ok('code' in body && body.code === code);
  assert.deepEqual(Object.keys(body).sort(), [
    'code',
    'message',
    'requestId',
    'statusCode',
    'timestamp',
  ]);
  assert.ok(!JSON.stringify(body).includes('private database password'));
}

void test('versioned health, security headers and server-generated request ID', async () => {
  const response = await fetch(`${base}/api/v1/health`, {
    headers: { 'x-request-id': 'attacker-controlled' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.notEqual(response.headers.get('x-request-id'), 'attacker-controlled');
  await assertError(await fetch(`${base}/health`), 404, 'NOT_FOUND');
  await assertError(await fetch(`${base}/api/v2/health`), 404, 'NOT_FOUND');
});
void test('readiness is 503 when database is unreachable', async () => {
  await assertError(
    await fetch(`${base}/api/v1/health/ready`),
    503,
    'SERVICE_UNAVAILABLE',
  );
});
void test('validation accepts valid DTO and rejects unknown fields and invalid types', async () => {
  const send = (body: unknown) =>
    fetch(`${base}/api/v1/probe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: config.appOrigin,
        'x-qrg-client': 'web',
      },
      body: JSON.stringify(body),
    });
  assert.equal((await send({ name: 'valid' })).status, 201);
  for (const body of [
    { name: 'valid', role: 'ADMIN' },
    { name: 42 },
    {},
    { name: '' },
    { name: 'a'.repeat(21) },
  ]) {
    await assertError(await send(body), 400, 'BAD_REQUEST');
  }
});
void test('malformed JSON and oversized payload use the same safe error format', async () => {
  const send = (body: string) =>
    fetch(`${base}/api/v1/probe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: config.appOrigin,
        'x-qrg-client': 'web',
      },
      body,
    });
  await assertError(await send('{'), 400, 'BAD_REQUEST');
  await assertError(
    await send(JSON.stringify({ name: 'a'.repeat(40000) })),
    413,
    'PAYLOAD_TOO_LARGE',
  );
});
void test('unexpected exceptions never expose internal messages', async () => {
  await assertError(
    await fetch(`${base}/api/v1/probe/failure`),
    500,
    'INTERNAL_SERVER_ERROR',
  );
});
void test('OpenAPI documents versioned health and readiness error schema', async () => {
  const response = await fetch(`${base}/api/openapi.json`);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(text.includes('/api/v1/health'));
  assert.ok(text.includes('ApiError'));
});
void test('Swagger is absent under production configuration', async () => {
  const production = loadConfig({
    NODE_ENV: 'production',
    DATABASE_URL: config.databaseUrl,
    APP_ORIGIN: 'https://qrg.example',
    AUTH_RATE_LIMIT_SECRET: 'test-rate-limit-secret-at-least-32-characters',
  });
  const prod = await NestFactory.create<NestExpressApplication>(
    AppModule.register(production),
    { logger: false, bodyParser: false },
  );
  try {
    await configureApplication(prod, production);
    await prod.listen(0, '127.0.0.1');
    const url = await prod.getUrl();
    await assertError(await fetch(`${url}/api/docs`), 404, 'NOT_FOUND');
    await assertError(await fetch(`${url}/api/openapi.json`), 404, 'NOT_FOUND');
  } finally {
    await prod.close();
  }
});
