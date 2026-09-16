import { Injectable, ServiceUnavailableException } from '@nestjs/common';
// Application port, not a bank DTO. Provider observations are NOT ledger events.
// References come from a durable server-created invoice binding,
// never a seller-supplied amount, account, subscription or callback body.
export interface PaymentReference {
  readonly attemptId: string;
  readonly subscriptionId: string;
  readonly invoiceId: string;
  readonly providerPaymentId: string;
}
export interface PaymentProviderIdentity {
  readonly provider: 'halyk';
  readonly environment: 'sandbox' | 'production';
  readonly merchantId: string;
}
// Internal commands. Invoice/subscription IDs come from PaymentInvoiceBindings;
// links come from approved server config, never request Host or frontend fields.
export interface InitialPaymentCommand {
  readonly attemptId: string;
  readonly subscriptionId: string;
  readonly invoiceId: string;
  readonly returnUrl: string;
  readonly callbackUrl: string;
  readonly callbackSecret: string;
}
export interface RecurringPaymentCommand {
  readonly attemptId: string;
  readonly subscriptionId: string;
  readonly invoiceId: string;
  readonly returnUrl: string;
  readonly callbackUrl: string;
  // Must eventually come from the encrypted mandate store with valid consent.
  readonly savedCardToken: string;
}
export type PaymentCheckout =
  | {
      readonly kind: 'hosted-script';
      readonly scriptUrl: string;
      readonly payload: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: 'redirect';
      readonly url: string;
    };
export interface PaymentSubmission {
  readonly providerPaymentId: string;
  readonly state: 'PENDING_RECONCILIATION' | 'REQUIRES_ACTION';
}
export interface PaymentObservation {
  readonly provider: 'halyk' | 'freedom_pay';
  readonly reference: PaymentReference;
  readonly state: 'SUCCEEDED' | 'FAILED' | 'PENDING' | 'REVIEW_REQUIRED';
  readonly amountMinor: number;
  readonly currency: 'KZT';
}

export abstract class PaymentProvider {
  abstract identity(): PaymentProviderIdentity | undefined;
  abstract available(): boolean;
  // Write-side contracts stay unavailable until callback authentication and
  // merchant settings are confirmed. Do not turn a status observation into success.
  abstract createInitialPayment(
    command?: InitialPaymentCommand,
  ): Promise<PaymentCheckout>;
  abstract chargeRecurring(
    command?: RecurringPaymentCommand,
  ): Promise<PaymentSubmission>;
  abstract getPaymentStatus(
    reference: PaymentReference,
  ): Promise<PaymentObservation>;
  abstract verifyCallback(notification: unknown): Promise<PaymentObservation>;
}
@Injectable()
export class UnconfiguredPaymentProvider extends PaymentProvider {
  identity(): undefined {
    return undefined;
  }
  available() {
    return false;
  }
  createInitialPayment(): Promise<never> {
    return Promise.reject(
      new ServiceUnavailableException(
        'Subscription payments are not connected',
      ),
    );
  }
  chargeRecurring(): Promise<never> {
    return Promise.reject(
      new ServiceUnavailableException(
        'Subscription payments are not connected',
      ),
    );
  }
  getPaymentStatus(): Promise<never> {
    return Promise.reject(
      new ServiceUnavailableException('Payment provider is not configured'),
    );
  }
  verifyCallback(): Promise<never> {
    return Promise.reject(
      new ServiceUnavailableException('Payment provider is not configured'),
    );
  }
}
