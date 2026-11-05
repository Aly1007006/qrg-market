'use client';
import { useState, useId, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select } from '../ui';
import { SellerApiError, loginErrorMessage } from '../../lib/seller/errors';
import { imageSelectionError } from '../../lib/seller/guidance';

export async function mutate(
  path: string,
  method: string,
  body: unknown,
  csrf = '',
  uploadId?: string,
): Promise<unknown> {
  const upload = body instanceof FormData;
  const response = await fetch('/api/seller/' + path, {
    method,
    headers: {
      'x-qrg-client': 'web',
      'x-qrg-csrf': csrf,
      ...(uploadId ? { 'x-qrg-upload-id': uploadId } : {}),
      ...(!upload ? { 'content-type': 'application/json' } : {}),
    },
    body: upload ? body : JSON.stringify(body),
    credentials: 'same-origin',
  }).catch(() => {
    throw new SellerApiError(
      0,
      'Нет связи с сервером. Проверьте интернет и повторите действие. Введённые данные остаются в форме.',
    );
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
    throw new SellerApiError(
      response.status,
      messages[response.status] ?? 'Не удалось сохранить. Попробуйте снова.',
    );
  }
  return response.status === 204 ? null : response.json();
}
export function LoginForm() {
  const [signup, setSignup] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    if (signup && data.get('password') !== data.get('passwordConfirmation')) {
      setMessage('Пароли не совпадают. Проверьте повторный ввод.');
      const confirmation = e.currentTarget.elements.namedItem(
        'passwordConfirmation',
      );
      if (confirmation instanceof HTMLInputElement) confirmation.focus();
      return;
    }
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
      setMessage(loginErrorMessage(e));
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
        type={showPassword ? 'text' : 'password'}
        minLength={12}
        maxLength={128}
        autoComplete={signup ? 'new-password' : 'current-password'}
        required
        aria-describedby="password-help"
      />
      <p id="password-help" className="muted">
        Используйте от 12 до 128 символов. Не используйте пароль от других
        сайтов.
      </p>
      {signup && (
        <Input
          id="password-confirmation"
          label="Повторите пароль"
          name="passwordConfirmation"
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      )}
      <Button
        type="button"
        variant="quiet"
        aria-pressed={showPassword}
        onClick={() => setShowPassword(!showPassword)}
      >
        {showPassword ? 'Скрыть пароль' : 'Показать пароль'}
      </Button>
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
  hint?: string;
  placeholder?: string;
  advanced?: boolean;
  min?: number;
  max?: number;
  step?: string;
}
export function SellerForm({
  path,
  method = 'POST',
  csrf,
  fields = [],
  label = 'Сохранить',
  redirectTo,
  numeric = [],
  successMessage = 'Изменения сохранены',
}: {
  path: string;
  method?: string;
  csrf: string;
  fields?: Field[];
  label?: string;
  redirectTo?: string;
  numeric?: string[];
  successMessage?: string;
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
      setMessage(successMessage);
      if (redirectTo) router.replace(redirectTo);
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="seller-form" aria-busy={busy}>
      {[false, true].map((advanced) => {
        const group = fields.filter(
          (field) => Boolean(field.advanced) === advanced,
        );
        if (!group.length) return null;
        const inputs = group.map((f) => (
          <div
            key={f.name}
            className={f.type === 'hidden' ? undefined : 'seller-field-group'}
          >
            {f.type === 'hidden' ? (
              <input key={f.name} type="hidden" name={f.name} value={f.value} />
            ) : f.options ? (
              <Select
                key={f.name}
                id={formId + f.name}
                name={f.name}
                label={f.label}
                defaultValue={f.value}
                required={f.required}
                disabled={busy}
                aria-describedby={
                  f.hint ? formId + f.name + '-help' : undefined
                }
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : f.type === 'textarea' ? (
              <label key={f.name} className="field" htmlFor={formId + f.name}>
                <span>{f.label}</span>
                <textarea
                  id={formId + f.name}
                  name={f.name}
                  defaultValue={f.value}
                  required={f.required}
                  maxLength={f.maxLength}
                  rows={6}
                  disabled={busy}
                  placeholder={f.placeholder}
                  aria-describedby={
                    f.hint ? formId + f.name + '-help' : undefined
                  }
                />
              </label>
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
                disabled={busy}
                placeholder={f.placeholder}
                aria-describedby={
                  f.hint ? formId + f.name + '-help' : undefined
                }
                {...(f.type === 'number'
                  ? { min: f.min ?? 0, max: f.max, step: f.step ?? '0.01' }
                  : {})}
              />
            )}
            {f.hint && (
              <p className="field-help" id={formId + f.name + '-help'}>
                {f.hint}
              </p>
            )}
          </div>
        ));
        return advanced ? (
          <details key="advanced" className="seller-advanced">
            <summary>Дополнительные поля — можно не заполнять</summary>
            {inputs}
          </details>
        ) : (
          <div key="main" className="seller-form-fields">
            {inputs}
          </div>
        );
      })}
      <Button disabled={busy}>{busy ? 'Подождите…' : label}</Button>
      <p role="status">{message}</p>
    </form>
  );
}
export function ImageUpload({
  path,
  csrf,
  count,
  replacementLabel,
}: {
  path: string;
  csrf: string;
  count: number;
  replacementLabel?: string;
}) {
  const inputId = useId();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<File | null>(null);
  const router = useRouter();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = new FormData(form);
    const file = body.get('file');
    const error = imageSelectionError(file instanceof File ? file : null);
    if (error) {
      setMessage(error);
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await mutate(path, 'POST', body, csrf);
      form.reset();
      setSelected(null);
      setMessage(
        'Фото загружено и сохранено. Оно появится выше после обновления.',
      );
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="seller-form seller-upload"
      onSubmit={submit}
      aria-busy={busy}
    >
      <Input
        id={inputId}
        name="file"
        label={
          replacementLabel
            ? `${replacementLabel}. JPEG, PNG, WEBP до 10 MB`
            : `Фото: ${count} из 10. JPEG, PNG, WEBP до 10 MB`
        }
        type="file"
        accept="image/jpeg,image/png,image/webp"
        required
        disabled={busy || count >= 10}
        aria-describedby={inputId + '-help'}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0] ?? null;
          setSelected(file);
          setMessage(file ? (imageSelectionError(file) ?? '') : '');
        }}
      />
      <p className="field-help" id={inputId + '-help'}>
        {count >= 10
          ? 'Добавлено 10 фото. Чтобы загрузить другое, сначала удалите одно из текущих.'
          : '1. Выберите файл. 2. Нажмите «Загрузить и сохранить фото». Выбор файла сам по себе его не сохраняет.'}
      </p>
      {selected && (
        <p className="upload-selection">
          Выбрано: <strong>{selected.name}</strong> ·{' '}
          {(selected.size / 1024 / 1024).toFixed(2)} MB
        </p>
      )}
      <Button
        disabled={
          busy ||
          count >= 10 ||
          !selected ||
          Boolean(imageSelectionError(selected))
        }
      >
        {busy ? 'Проверяем и сохраняем фото…' : 'Загрузить и сохранить фото'}
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
