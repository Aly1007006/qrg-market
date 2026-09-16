import { BadRequestException } from '@nestjs/common';
import type {
  InitialPaymentCommand,
  RecurringPaymentCommand,
} from '../provider.js';
import { BUSINESS } from '../state.js';
import { UUID } from './config.js';

export interface HalykAuthorization {
  readonly access_token: string;
  readonly expires_in: number;
  readonly token_type: 'Bearer';
  readonly scope: string;
  readonly refresh_token: string;
}

// This only validates link shape. The future coordinator must supply approved
// deployment config; this is not an API accepting arbitrary caller destinations.
function httpsLink(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException();
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.port ||
    url.hostname === 'localhost' ||
    !url.hostname.includes('.') ||
    url.hostname.includes(':') ||
    /^\d+(?:\.\d+){3}$/.test(url.hostname) ||
    value.length > 2048 ||
    /[\s\\]/u.test(value)
  )
    throw new BadRequestException();
}

export function validatePaymentCommand(
  command: InitialPaymentCommand | RecurringPaymentCommand,
  kind: 'initial' | 'recurring',
): void {
  if (
    !UUID.test(command.attemptId) ||
    !UUID.test(command.subscriptionId) ||
    !/^[1-9][0-9]{5}$/.test(command.invoiceId)
  )
    throw new BadRequestException();
  httpsLink(command.returnUrl);
  httpsLink(command.callbackUrl);
  if (
    kind === 'initial' &&
    (!('callbackSecret' in command) ||
      typeof command.callbackSecret !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(command.callbackSecret))
  )
    throw new BadRequestException();
  if (
    kind === 'recurring' &&
    (!('savedCardToken' in command) ||
      typeof command.savedCardToken !== 'string' ||
      !UUID.test(command.savedCardToken))
  )
    throw new BadRequestException();
}

export const PAYMENT_DESCRIPTION = 'QRG BUSINESS subscription';

export function hostedPaymentPayload(
  command: InitialPaymentCommand,
  terminal: string,
  auth: HalykAuthorization,
) {
  return Object.freeze({
    invoiceId: command.invoiceId,
    backLink: command.returnUrl,
    failureBackLink: command.returnUrl,
    postLink: command.callbackUrl,
    failurePostLink: command.callbackUrl,
    language: 'rus',
    description: PAYMENT_DESCRIPTION,
    accountId: command.subscriptionId,
    terminal,
    amount: BUSINESS.amountMinor / 100,
    currency: BUSINESS.currency,
    // Card saving/recurring is NOT enabled by this first-payment payload.
    // That requires a real, revocable mandate and separate recorded consent.
    auth,
  });
}

export function recurringPaymentPayload(
  command: RecurringPaymentCommand,
  terminalId: string,
) {
  return Object.freeze({
    amount: BUSINESS.amountMinor / 100,
    currency: BUSINESS.currency,
    terminalId,
    invoiceId: command.invoiceId,
    description: PAYMENT_DESCRIPTION,
    accountId: command.subscriptionId,
    backLink: command.returnUrl,
    failureBackLink: command.returnUrl,
    postLink: command.callbackUrl,
    failurePostLink: command.callbackUrl,
    language: 'rus',
    paymentType: 'cardId',
    recurrent: true,
    cardId: Object.freeze({ id: command.savedCardToken }),
  });
}
