import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export interface ResetMessage {
  readonly email: string;
  readonly token: string;
  readonly expiresAt: Date;
}
export abstract class PasswordResetDelivery {
  abstract available(): boolean;
  abstract send(message: ResetMessage): Promise<void>;
}

@Injectable()
export class UnconfiguredPasswordResetDelivery extends PasswordResetDelivery {
  available(): boolean {
    return false;
  }
  send(): Promise<void> {
    return Promise.reject(new ServiceUnavailableException());
  }
}
