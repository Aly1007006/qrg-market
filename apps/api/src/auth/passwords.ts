import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnModuleInit,
} from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';
import { newToken } from './tokens.js';

export const ARGON2_OPTIONS = {
  type: argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
} as const;
let dummyHash: Promise<string> | undefined;

@Injectable()
export class Passwords implements OnModuleInit {
  private active = 0;
  async onModuleInit(): Promise<void> {
    await this.dummy();
  }
  private dummy(): Promise<string> {
    return (dummyHash ??= hash(newToken(), ARGON2_OPTIONS));
  }
  private async bounded<T>(operation: () => Promise<T>): Promise<T> {
    // Bound memory/CPU usage; reject overload instead of growing an unbounded queue.
    if (this.active >= 4) throw new ServiceUnavailableException();
    this.active++;
    try {
      return await operation();
    } finally {
      this.active--;
    }
  }
  hash(password: string): Promise<string> {
    return this.bounded(() => hash(password, ARGON2_OPTIONS));
  }
  verify(passwordHash: string | undefined, password: string): Promise<boolean> {
    return this.bounded(async () => {
      try {
        const matches = await verify(
          passwordHash ?? (await this.dummy()),
          password,
        );
        return passwordHash !== undefined && matches;
      } catch {
        new Logger(Passwords.name).error({
          event: 'password_verification_failed',
        });
        return false;
      }
    });
  }
}
