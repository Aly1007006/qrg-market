import { ServiceUnavailableException } from '@nestjs/common';
import { HALYK_ENDPOINTS, UUID, type HalykConfig } from './config.js';
import { BUSINESS } from '../state.js';
import type {
  InitialPaymentCommand,
  RecurringPaymentCommand,
  PaymentSubmission,
} from '../provider.js';
import {
  hostedPaymentPayload,
  recurringPaymentPayload,
  validatePaymentCommand,
  type HalykAuthorization,
} from './contracts.js';

// Real HTTP transport in production; injectable only to keep contract tests offline.
export type HalykTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>;
const MAX_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 5000;
const SCOPE =
  'webapi usermanagement email_send verification statement statistics payment';

export function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function unavailable(): ServiceUnavailableException {
  // No upstream response, URL, credentials, token, card metadata or error cause.
  return new ServiceUnavailableException('Halyk status could not be verified');
}

export class HalykHttpClient {
  constructor(
    private readonly config: HalykConfig,
    private readonly transport: HalykTransport = (url, init) =>
      fetch(url, init),
  ) {
    this.config = Object.freeze({ ...config });
  }

  private async json(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.transport(url, {
        ...init,
        signal: controller.signal,
        redirect: 'error',
        cache: 'no-store',
        credentials: 'omit',
      });
      if (
        !response.ok ||
        !/^application\/json(?:\s*;|$)/i.test(
          response.headers.get('content-type') ?? '',
        )
      )
        throw unavailable();
      const length = response.headers.get('content-length');
      if (
        length !== null &&
        (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)
      )
        throw unavailable();
      if (!response.body) throw unavailable();
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) throw unavailable();
        chunks.push(item.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      // Timeouts, redirects, invalid JSON and provider 4xx/5xx are NOT declined payments.
      throw unavailable();
    } finally {
      controller.abort();
      clearTimeout(timeout);
      reader?.releaseLock();
    }
  }

  private async authorize(
    payment?: InitialPaymentCommand | RecurringPaymentCommand,
  ): Promise<HalykAuthorization> {
    const endpoint = HALYK_ENDPOINTS[this.config.environment];
    const body = new FormData();
    body.set('grant_type', 'client_credentials');
    body.set('scope', SCOPE);
    body.set('client_id', this.config.clientId);
    body.set('client_secret', this.config.clientSecret);
    body.set('terminal', this.config.terminalId);
    if (payment) {
      body.set('invoiceID', payment.invoiceId);
      body.set('amount', String(BUSINESS.amountMinor / 100));
      body.set('currency', BUSINESS.currency);
      body.set('postLink', payment.callbackUrl);
      body.set('failurePostLink', payment.callbackUrl);
      // The saved-card OAuth example does not document secret_hash. Do not add it
      // there by analogy; recurring callback auth still needs bank clarification.
      if ('callbackSecret' in payment)
        body.set('secret_hash', payment.callbackSecret);
    }
    // Each operation gets a fresh token. Only an initial, amount-bound payment
    // token belongs in a hosted checkout payload; status/recurring tokens stay here.
    const auth = object(
      await this.json(endpoint.oauth, { method: 'POST', body }),
    );
    if (
      !auth ||
      typeof auth.access_token !== 'string' ||
      !/^[A-Za-z0-9._~+/-]+=*$/.test(auth.access_token) ||
      auth.access_token.length > 8192 ||
      auth.token_type !== 'Bearer' ||
      typeof auth.expires_in !== 'number' ||
      !Number.isSafeInteger(auth.expires_in) ||
      auth.expires_in <= 0
    )
      throw unavailable();
    if (
      payment &&
      (typeof auth.scope !== 'string' ||
        auth.scope.length > 1024 ||
        !auth.scope.split(/\s+/u).includes('payment') ||
        auth.refresh_token !== '')
    )
      throw unavailable();
    return Object.freeze({
      access_token: auth.access_token,
      expires_in: auth.expires_in,
      token_type: 'Bearer',
      scope: typeof auth.scope === 'string' ? auth.scope : '',
      refresh_token: '',
    });
  }
  async status(invoiceId: string): Promise<unknown> {
    if (!/^\d{6,15}$/.test(invoiceId)) throw unavailable();
    const endpoint = HALYK_ENDPOINTS[this.config.environment];
    const auth = await this.authorize();
    return this.json(
      endpoint.api + '/check-status/payment/transaction/' + invoiceId,
      {
        method: 'GET',
        headers: {
          authorization: 'Bearer ' + auth.access_token,
          accept: 'application/json',
        },
      },
    );
  }

  async initialPayment(command: InitialPaymentCommand) {
    validatePaymentCommand(command, 'initial');
    const expected = Object.freeze({
      attemptId: command.attemptId,
      subscriptionId: command.subscriptionId,
      invoiceId: command.invoiceId,
      returnUrl: command.returnUrl,
      callbackUrl: command.callbackUrl,
      callbackSecret: command.callbackSecret,
    });
    const auth = await this.authorize(expected);
    return Object.freeze({
      kind: 'hosted-script' as const,
      scriptUrl: HALYK_ENDPOINTS[this.config.environment].script,
      payload: hostedPaymentPayload(expected, this.config.terminalId, auth),
    });
  }

  async recurringPayment(
    command: RecurringPaymentCommand,
  ): Promise<PaymentSubmission> {
    validatePaymentCommand(command, 'recurring');
    const expected = Object.freeze({
      attemptId: command.attemptId,
      subscriptionId: command.subscriptionId,
      invoiceId: command.invoiceId,
      returnUrl: command.returnUrl,
      callbackUrl: command.callbackUrl,
      savedCardToken: command.savedCardToken,
    });
    const auth = await this.authorize(expected);
    // Exactly one POST. A lost response must be reconciled, never retried blindly.
    const result = object(
      await this.json(
        HALYK_ENDPOINTS[this.config.environment].api + '/payments/cards/auth',
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer ' + auth.access_token,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(
            recurringPaymentPayload(expected, this.config.terminalId),
          ),
        },
      ),
    );
    if (
      !result ||
      result.code !== 0 ||
      typeof result.id !== 'string' ||
      !UUID.test(result.id)
    )
      throw unavailable();
    if (result.status === '3D') {
      // Do not forward/log/store paReq, md, action or collect a 3DS code at QRG.
      return Object.freeze({
        providerPaymentId: result.id,
        state: 'REQUIRES_ACTION',
      });
    }
    if (
      result.invoiceID !== expected.invoiceId ||
      result.amount !== BUSINESS.amountMinor / 100 ||
      result.currency !== BUSINESS.currency ||
      (result.accountId !== '' &&
        result.accountId !== expected.subscriptionId) ||
      (result.amountBonus !== undefined && result.amountBonus !== 0) ||
      result.status !== 'AUTH' ||
      result.secure3D !== null
    )
      throw unavailable();
    // AUTH only blocks funds. Even a successful submission NEVER activates access.
    return Object.freeze({
      providerPaymentId: result.id,
      state: 'PENDING_RECONCILIATION',
    });
  }
}
