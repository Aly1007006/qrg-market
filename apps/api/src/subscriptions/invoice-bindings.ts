import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { Database, type Transaction } from '../database.js';
import { paymentAttempts, paymentProviderBindings } from '../db/schema.js';
import {
  PaymentProvider,
  type PaymentProviderIdentity,
  type PaymentReference,
} from './provider.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Attempt = typeof paymentAttempts.$inferSelect;

@Injectable()
export class PaymentInvoiceBindings {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(PaymentProvider) private readonly provider: PaymentProvider,
  ) {}
  private identity(): PaymentProviderIdentity {
    const identity = this.provider.identity();
    if (!identity)
      throw new ServiceUnavailableException(
        'Payment provider is not configured',
      );
    return identity;
  }
  // INTERNAL persistence hook for SubscriptionService.beginAttempt. Caller holds
  // shop/subscription locks. No seller HTTP route accepts a binding/merchant/invoice.
  async bind(tx: Transaction, attempt: Attempt): Promise<void> {
    const identity = this.identity();
    const [existing] = await tx
      .select()
      .from(paymentProviderBindings)
      .where(eq(paymentProviderBindings.attemptId, attempt.id));
    if (existing) {
      if (
        existing.subscriptionId !== attempt.subscriptionId ||
        existing.provider !== identity.provider ||
        existing.environment !== identity.environment ||
        existing.merchantId !== identity.merchantId
      )
        throw new ConflictException();
      return;
    }
    if (attempt.status !== 'PENDING') throw new ConflictException();
    await tx.insert(paymentProviderBindings).values({
      attemptId: attempt.id,
      subscriptionId: attempt.subscriptionId,
      ...identity,
    });
  }
  // Internal read-only reconciliation. The provider-supplied ID still must match
  // authenticated bank status; neither it nor a status observation activates access.
  async reference(
    attemptId: string,
    providerPaymentId: string,
  ): Promise<PaymentReference> {
    if (!uuid.test(attemptId) || !uuid.test(providerPaymentId))
      throw new BadRequestException();
    const identity = this.identity();
    const [binding] = await this.db.client
      .select({ binding: paymentProviderBindings, attempt: paymentAttempts })
      .from(paymentProviderBindings)
      .innerJoin(
        paymentAttempts,
        and(
          eq(paymentAttempts.id, paymentProviderBindings.attemptId),
          eq(
            paymentAttempts.subscriptionId,
            paymentProviderBindings.subscriptionId,
          ),
        ),
      )
      .where(
        and(
          eq(paymentProviderBindings.attemptId, attemptId),
          eq(paymentProviderBindings.provider, identity.provider),
          eq(paymentProviderBindings.environment, identity.environment),
          eq(paymentProviderBindings.merchantId, identity.merchantId),
        ),
      );
    if (!binding) throw new NotFoundException();
    if (
      binding.attempt.providerPaymentId !== null &&
      (binding.attempt.providerPaymentId !== providerPaymentId ||
        binding.attempt.provider !== identity.provider)
    )
      throw new ConflictException();
    return Object.freeze({
      attemptId: binding.binding.attemptId,
      subscriptionId: binding.binding.subscriptionId,
      invoiceId: binding.binding.invoiceId,
      providerPaymentId,
    });
  }
  async inspect(attemptId: string, providerPaymentId: string) {
    return this.provider.getPaymentStatus(
      await this.reference(attemptId, providerPaymentId),
    );
  }
  async referenceForInvoice(
    invoiceId: string,
    providerPaymentId: string,
  ): Promise<PaymentReference> {
    if (!/^[1-9][0-9]{5}$/.test(invoiceId) || !uuid.test(providerPaymentId))
      throw new BadRequestException();
    const identity = this.identity();
    const [binding] = await this.db.client
      .select({ attemptId: paymentProviderBindings.attemptId })
      .from(paymentProviderBindings)
      .where(
        and(
          eq(paymentProviderBindings.invoiceId, invoiceId),
          eq(paymentProviderBindings.provider, identity.provider),
          eq(paymentProviderBindings.environment, identity.environment),
          eq(paymentProviderBindings.merchantId, identity.merchantId),
        ),
      );
    if (!binding) throw new NotFoundException();
    return this.reference(binding.attemptId, providerPaymentId);
  }
}
