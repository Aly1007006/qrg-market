import 'server-only';
import { headers } from 'next/headers';
import { validRequestNonce } from './security-headers';

export async function requestNonce() {
  return validRequestNonce((await headers()).get('x-nonce'));
}
