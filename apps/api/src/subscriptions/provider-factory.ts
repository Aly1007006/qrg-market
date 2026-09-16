import { HalykPaymentProvider } from './halyk/provider.js';
import { loadHalykConfig } from './halyk/config.js';
import { PaymentProvider, UnconfiguredPaymentProvider } from './provider.js';

// Future FreedomPayProvider belongs behind this port. No guessed Freedom API stub.
export function createPaymentProvider(
  env: NodeJS.ProcessEnv = process.env,
): PaymentProvider {
  const config = loadHalykConfig(env);
  return config
    ? new HalykPaymentProvider(config)
    : new UnconfiguredPaymentProvider();
}
