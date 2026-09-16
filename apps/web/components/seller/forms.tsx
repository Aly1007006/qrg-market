'use client';
import { useState, useId, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select } from '../ui';

export async function mutate(
  path: string,
  method: string,
  body: unknown,
  csrf = '',
): Promise<unknown> {
  const upload = body instanceof FormData;
  const response = await fetch('/api/seller/' + path, {
    method,
    headers: {
      'x-qrg-client': 'web',
      'x-qrg-csrf': csrf,
      ...(!upload ? { 'content-type': 'application/json' } : {}),
    },
    body: upload ? body : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (!response.ok) {
    const messages: Record<number, string> = {
      400: 'Проверьте поля формы и формат файла.',
      401: 'Сессия истекла. Войдите снова.',
      403: 'Недостаточно прав для этой операции.',
      404: 'Объект не найден или недоступен.',
      409: 'Данные изменились или нарушено ограничение. Обновите страницу и повторите действие.',
      413: 'Файл превышает 10 MB.',
      415: 'Разрешены только JPEG, PNG и WEBP.',
      429: 'Слишком много запросов. Попробуйте позже.',
      503: 'Сервис ещё не настроен. Обратитесь к владельцу QRG.',
    };
    throw new Error(
      messages[response.status] ?? 'Не удалось сохранить. Попробуйте снова.',
    );
  }
  return response.status === 204 ? null : response.json();
}
export function LoginForm() {
  const [signup, setSignup] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setMessage('');
    try {
      await mutate('auth/' + (signup ? 'signup' : 'login'), 'POST', {
        email: data.get('email'),
        password: data.get('password'),
      });
      if (signup) {
        setMessage(
          'Если регистрация доступна, аккаунт создан. Теперь войдите.',
        );
        setSignup(false);
      } else {
        router.replace('/seller');
        router.refresh();
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="seller-form">
      <Input
        id="email"
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        required
        maxLength={254}
      />
      <Input
        id="password"
        label="Пароль"
        name="password"
        type="password"
        minLength={12}
        maxLength={128}
        autoComplete={signup ? 'new-password' : 'current-password'}
        required
      />
      <Button disabled={busy}>
        {busy ? 'Подождите…' : signup ? 'Создать аккаунт' : 'Войти'}
      </Button>
      <Button
        type="button"
        variant="quiet"
        disabled={busy}
        onClick={() => {
          setSignup(!signup);
          setMessage('');
        }}
      >
        {signup ? 'Уже есть аккаунт' : 'Регистрация продавца'}
      </Button>
      <p role="status">{message}</p>
    </form>
  );
}
export interface Field {
  nullable?: boolean;
  name: string;
  label: string;
  type?: string;
  value?: string | number;
  required?: boolean;
  options?: { value: string; label: string }[];
  maxLength?: number;
}
export function SellerForm({
  path,
  method = 'POST',
  csrf,
  fields = [],
  label = 'Сохранить',
  redirectTo,
  numeric = [],
}: {
  path: string;
  method?: string;
  csrf: string;
  fields?: Field[];
  label?: string;
  redirectTo?: string;
  numeric?: string[];
}) {
  const formId = useId();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    const data = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {};
    for (const field of fields) {
      const value = data.get(field.name);
      body[field.name] =
        field.nullable && value === ''
          ? null
          : numeric.includes(field.name)
            ? value === ''
              ? null
              : Number(value)
            : value;
    }
    try {
      await mutate(path, method, body, csrf);
      setMessage('Сохранено');
      if (redirectTo) router.replace(redirectTo);
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="seller-form">
      {fields.map((f) =>
        f.type === 'hidden' ? (
          <input key={f.name} type="hidden" name={f.name} value={f.value} />
        ) : f.options ? (
          <Select
            key={f.name}
            id={formId + f.name}
            name={f.name}
            label={f.label}
            defaultValue={f.value}
            required={f.required}
          >
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            key={f.name}
            id={formId + f.name}
            name={f.name}
            label={f.label}
            type={f.type ?? 'text'}
            defaultValue={f.value}
            required={f.required}
            maxLength={f.maxLength}
            {...(f.type === 'number' ? { min: 0, step: '0.01' } : {})}
          />
        ),
      )}
      <Button disabled={busy}>{busy ? 'Подождите…' : label}</Button>
      <p role="status">{message}</p>
    </form>
  );
}
export function ImageUpload({
  path,
  csrf,
  count,
}: {
  path: string;
  csrf: string;
  count: number;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = new FormData(form);
    const file = body.get('file');
    if (!(file instanceof File) || file.size > 10 * 1024 * 1024) {
      setMessage('Выберите файл до 10 MB.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await mutate(path, 'POST', body, csrf);
      form.reset();
      setMessage('Изображение добавлено');
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="seller-form" onSubmit={submit}>
      <Input
        id="file"
        name="file"
        label={`Фото: ${count} из 10. JPEG, PNG, WEBP до 10 MB`}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        required
        disabled={busy || count >= 10}
      />
      <Button disabled={busy || count >= 10}>
        {busy ? 'Обрабатываем…' : 'Загрузить фото'}
      </Button>
      <p role="status">{message}</p>
    </form>
  );
}
export function Availability({
  path,
  csrf,
  variant,
}: {
  path: string;
  csrf: string;
  variant: Record<string, unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const router = useRouter();
  return (
    <div>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage('');
          try {
            await mutate(
              path,
              'PUT',
              {
                size: variant.size,
                color: variant.color,
                sku: variant.sku,
                priceOverride: variant.priceOverride,
                available: !variant.available,
              },
              csrf,
            );
            router.refresh();
          } catch (e) {
            setMessage(e instanceof Error ? e.message : 'Ошибка');
          } finally {
            setBusy(false);
          }
        }}
      >
        {variant.available ? 'Отметить: нет в наличии' : 'Отметить: в наличии'}
      </Button>
      <p role="status">{message}</p>
    </div>
  );
}
