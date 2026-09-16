'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Input, Button, Select } from '../ui';
export async function mutate(
  path: string,
  body: unknown,
  csrf = '',
): Promise<unknown> {
  const r = await fetch('/api/admin/' + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-qrg-client': 'web',
      'x-qrg-csrf': csrf,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) {
    const errors: Record<number, string> = {
      400: 'Проверьте поля и причину решения.',
      401: 'Проверьте данные входа и код. Возможно, сессия истекла.',
      403: 'Нет разрешения на это действие.',
      404: 'Магазин или проверка недоступны.',
      409: 'Статус изменился. Обновите страницу перед решением.',
      429: 'Слишком много попыток. Повторите через 15 минут.',
      503: 'Административный доступ временно недоступен или не настроен.',
    };
    throw new Error(
      errors[r.status] ?? 'Не удалось выполнить действие. Обновите страницу.',
    );
  }
  return r.status === 204 ? null : r.json();
}
export function AdminLoginForm() {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setMessage('');
    try {
      await mutate('auth/login', {
        email: data.get('email'),
        password: data.get('password'),
        code: data.get('code'),
      });
      form.reset();
      router.replace('/admin');
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="seller-form" onSubmit={submit}>
      <Input
        id="admin-email"
        name="email"
        label="Email администратора"
        type="email"
        autoComplete="username"
        required
        maxLength={254}
      />
      <Input
        id="admin-password"
        name="password"
        label="Пароль"
        type="password"
        autoComplete="current-password"
        required
        maxLength={128}
      />
      <Input
        id="admin-code"
        name="code"
        label="Код из приложения или резервный код (при первом входе оставьте пустым)"
        autoComplete="one-time-code"
        maxLength={32}
      />
      <Button disabled={busy}>
        {busy ? 'Проверяем…' : 'Войти в Admin Area'}
      </Button>
      <p role="status">{message}</p>
    </form>
  );
}
export function AdminSessionAction({
  csrf,
  action,
}: {
  csrf: string;
  action: 'logout' | 'rotate';
}) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage('');
          try {
            await mutate('auth/' + action, {}, csrf);
            if (action === 'logout') router.replace('/admin/login');
            router.refresh();
            setMessage(
              action === 'rotate'
                ? 'Токен обновлён. Срок сессии не продлён.'
                : 'Вы вышли',
            );
          } catch (e) {
            setMessage(e instanceof Error ? e.message : 'Ошибка');
          } finally {
            setBusy(false);
          }
        }}
      >
        {action === 'logout' ? 'Выйти' : 'Обновить токен сессии'}
      </Button>
      <p role="status">{message}</p>
    </div>
  );
}
export function AdminDecisionForm({
  shopId,
  status,
  caseId,
  actions,
  csrf,
}: {
  shopId: string;
  status: string;
  caseId: string | null;
  actions: { value: string; label: string }[];
  csrf: string;
}) {
  const router = useRouter();
  const [action, setAction] = useState(actions[0]?.value ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (!actions.length)
    return <p>Нет доступных решений для этого статуса и ваших прав.</p>;
  return (
    <form
      className="seller-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setBusy(true);
        setMessage('');
        try {
          await mutate(
            'shops/' + shopId + '/decisions',
            {
              action,
              expectedStatus: status,
              caseId,
              reason: data.get('reason'),
            },
            csrf,
          );
          setMessage('Решение сохранено');
          router.refresh();
        } catch (e) {
          setMessage(e instanceof Error ? e.message : 'Ошибка');
        } finally {
          setBusy(false);
        }
      }}
    >
      <Select
        id="admin-decision"
        label="Решение"
        value={action}
        onChange={(e) => setAction(e.target.value)}
      >
        {actions.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </Select>
      <label className="field" htmlFor="admin-reason">
        <span>
          Причина, которую увидит продавец
          {action === 'APPROVE' ? ' (необязательно)' : ''}
        </span>
        <textarea
          id="admin-reason"
          name="reason"
          maxLength={2000}
          rows={4}
          required={action !== 'APPROVE'}
        />
      </label>
      <label className="request-consent">
        <input type="checkbox" required key={action} />
        <span>
          Я проверил магазин и подтверждаю выбранное решение. Действие будет
          записано в аудит.
        </span>
      </label>
      <Button disabled={busy}>
        {busy ? 'Сохраняем…' : 'Применить решение'}
      </Button>
      <p role="status">{message}</p>
    </form>
  );
}
