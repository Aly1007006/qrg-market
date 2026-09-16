import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PaymentProvider,
  type PaymentObservation,
  type PaymentReference,
  type PaymentProviderIdentity,
  type InitialPaymentCommand,
  type RecurringPaymentCommand,
  type PaymentCheckout,
  type PaymentSubmission,
} from '../provider.js';
import { BUSINESS } from '../state.js';
import { UUID, type HalykConfig } from './config.js';
import {
  HalykHttpClient,
  object,
  unavailable,
  type HalykTransport,
} from './client.js';

export class HalykPaymentProvider extends PaymentProvider {
  private readonly client: HalykHttpClient;
  constructor(
    private readonly config: HalykConfig,
    transport?: HalykTransport,
  ) {
    super();
    this.config = Object.freeze({ ...config });
    this.client = new HalykHttpClient(this.config, transport);
  }
  available(): boolean {
    // HARD release gate, not an environment flag: the required signature contract
    // is absent from the public docs. Supplying credentials MUST NOT enable charges.
    return false;
  }
  identity(): PaymentProviderIdentity {
    return Object.freeze({
      provider: 'halyk',
      environment: this.config.environment,
      merchantId: this.config.terminalId,
    });
  }
  createInitialPayment(
    command?: InitialPaymentCommand,
  ): Promise<PaymentCheckout> {
    if (!this.available())
      return Promise.reject(
        new ServiceUnavailableException(
          'Halyk checkout awaits callback signature contract and merchant acceptance',
        ),
      );
    if (!command) return Promise.reject(new BadRequestException());
    return this.client.initialPayment(command);
  }
  chargeRecurring(
    command?: RecurringPaymentCommand,
  ): Promise<PaymentSubmission> {
    if (!this.available())
      return Promise.reject(
        new ServiceUnavailableException(
          'Halyk recurring awaits merchant mandate and 3DS configuration',
        ),
      );
    if (!command) return Promise.reject(new BadRequestException());
    return this.client.recurringPayment(command);
  }
  verifyCallback(notification: unknown): Promise<never> {
    // secret_hash is an echoed secret, NOT a documented MAC/signature. Do not
    // invent signature headers, canonicalization or keys, or accept a fake one.
    void notification;
    return Promise.reject(
      new ServiceUnavailableException(
        'Halyk callback signature contract is not configured',
      ),
    );
  }
  async getPaymentStatus(
    reference: PaymentReference,
  ): Promise<PaymentObservation> {
    if (
      !UUID.test(reference.attemptId) ||
      !UUID.test(reference.subscriptionId) ||
      !UUID.test(reference.providerPaymentId) ||
      !/^\d{6,15}$/.test(reference.invoiceId)
    )
      throw new BadRequestException();
    // Snapshot before await: a caller cannot replace the expected binding in flight.
    const expected = Object.freeze({ ...reference });
    const response = object(await this.client.status(expected.invoiceId));
    if (!response) throw unavailable();
    // Reject/not-found/in-progress without a transaction proves no identity or
    // amount. Do NOT manufacture a terminal FAILED outcome from resultCode alone.
    if (
      typeof response.resultCode === 'string' &&
      ['101', '102', '107'].includes(response.resultCode) &&
      response.transaction === null
    )
      return Object.freeze({
        provider: 'halyk',
        reference: expected,
        state: 'PENDING',
        amountMinor: BUSINESS.amountMinor,
        currency: 'KZT',
      });
    const payment = object(response.transaction);
    if (
      response.resultCode !== '100' ||
      !payment ||
      payment.id !== expected.providerPaymentId ||
      payment.invoiceID !== expected.invoiceId ||
      payment.terminalID !== this.config.terminalId ||
      payment.accountID !== expected.subscriptionId ||
      payment.amount !== BUSINESS.amountMinor / 100 ||
      payment.currency !== BUSINESS.currency
    )
      throw unavailable();
    // Reject ambiguous split/bonus amounts until that merchant feature is specified.
    if (
      (payment.amountBonus !== undefined && payment.amountBonus !== 0) ||
      (payment.orgAmount !== undefined &&
        payment.orgAmount !== BUSINESS.amountMinor / 100)
    )
      throw unavailable();
    let state: PaymentObservation['state'] = 'REVIEW_REQUIRED';
    if (payment.statusName === 'CHARGE') state = 'SUCCEEDED';
    if (payment.statusName === 'FAILED' || payment.statusName === 'REJECT')
      state = 'FAILED';
    if (
      typeof payment.statusName === 'string' &&
      ['AUTH', 'NEW', 'FINGERPRINT', '3D'].includes(payment.statusName)
    )
      state = 'PENDING';
    // Safe projection only. Not a callback verification and never a ledger command.
    return Object.freeze({
      provider: 'halyk',
      reference: expected,
      state,
      amountMinor: BUSINESS.amountMinor,
      currency: 'KZT',
    });
  }
}
