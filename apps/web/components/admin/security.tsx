'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '../ui';
import { mutate, AdminSessionAction } from './forms';
import { array, record, string } from '../../lib/catalogue/contract';
export function AdminSecurity({
  csrf,
  mustChangePassword,
  mfaEnrolled,
}: {
  csrf: string;
  mustChangePassword: boolean;
  mfaEnrolled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [setup, setSetup] = useState<{ secret: string; qr: string }>();
  const [codes, setCodes] = useState<string[]>();
  const router = useRouter();
  async function password(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    if (data.get('newPassword') !== data.get('confirm')) {
      setMessage('Новые пароли не совпадают.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await mutate(
        'auth/password',
        {
          currentPassword: data.get('currentPassword'),
          newPassword: data.get('newPassword'),
        },
        csrf,
      );
      form.reset();
      router.replace('/admin/login');
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Не удалось изменить пароль.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    setBusy(true);
    setMessage('');
    try {
      const data = record(await mutate('auth/mfa/setup', {}, csrf));
      const qr = await import('qrcode');
      setSetup({
        secret: string(data.secret),
        qr: await qr.toDataURL(string(data.uri), { width: 280, margin: 4 }),
      });
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Не удалось настроить 2FA.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function verify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setMessage('');
    try {
      const data = record(
        await mutate(
          'auth/mfa/verify',
          { code: new FormData(form).get('code') },
          csrf,
        ),
      );
      setCodes(array(data.recoveryCodes).map(string));
      setSetup(undefined);
      form.reset();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Не удалось подтвердить код.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (codes)
    return (
      <section>
        <h1>2FA включена</h1>
        <p>
          Сохраните резервные коды в менеджере паролей. Каждый действует один
          раз. После закрытия страницы они больше не показываются.
        </p>
        <ul>
          {codes.map((code) => (
            <li key={code}>
              <code>{code}</code>
            </li>
          ))}
        </ul>
        <Link className="button button-primary" href="/admin/login">
          Коды сохранены — войти с 2FA
        </Link>
      </section>
    );
  return (
    <section>
      <h1>Безопасность администратора</h1>
      {mustChangePassword && (
        <p>
          Перед работой смените временный пароль. Затем настройте двухфакторную
          защиту.
        </p>
      )}
      <form className="seller-form" onSubmit={password}>
        <Input
          id="admin-current-password"
          name="currentPassword"
          label="Текущий пароль"
          type="password"
          autoComplete="current-password"
          maxLength={128}
          required
        />
        <Input
          id="admin-new-password"
          name="newPassword"
          label="Новый пароль — не менее 12 символов"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
        <Input
          id="admin-confirm-password"
          name="confirm"
          label="Повторите новый пароль"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
        <Button disabled={busy}>Сменить пароль и завершить сессии</Button>
      </form>
      {!mustChangePassword && !mfaEnrolled && (
        <section>
          <h2>Двухфакторная защита</h2>
          <p>
            Добавьте аккаунт в приложение-аутентификатор. Работа с данными
            платформы откроется после подтверждения кода.
          </p>
          {setup ? (
            <>
              <Image
                src={setup.qr}
                width={280}
                height={280}
                unoptimized
                alt="QR-код для настройки двухфакторной защиты"
              />
              <p>
                Для ручного ввода:{' '}
                <code style={{ overflowWrap: 'anywhere' }}>{setup.secret}</code>
              </p>
              <form className="seller-form" onSubmit={verify}>
                <Input
                  id="enrollment-code"
                  name="code"
                  label="Шестизначный код"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  required
                />
                <Button disabled={busy}>Подтвердить 2FA</Button>
              </form>
            </>
          ) : (
            <Button disabled={busy} onClick={() => void start()}>
              Настроить 2FA
            </Button>
          )}
        </section>
      )}
      {mfaEnrolled && <p>Двухфакторная защита включена.</p>}
      <p role="alert">{message}</p>
      <AdminSessionAction action="logout" csrf={csrf} />
    </section>
  );
}
