'use client';
import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select } from '../ui';
import { mutate } from './forms';
type Field = {
  name: string;
  label: string;
  type?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
};
export function AdminActionForm({
  path,
  csrf,
  label,
  fixed = {},
  fields = [],
  confirm = true,
}: {
  path: string;
  csrf: string;
  label: string;
  fixed?: Record<string, string>;
  fields?: Field[];
  confirm?: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (
      confirm &&
      !window.confirm(label + '? Действие будет записано в журнал аудита.')
    )
      return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const body: Record<string, unknown> = {
      ...fixed,
      reason: data.get('reason'),
    };
    for (const field of fields) {
      const value = data.get(field.name);
      if (value !== '') body[field.name] = value;
    }
    setBusy(true);
    setMessage('');
    try {
      await mutate(path, body, csrf);
      form.reset();
      setMessage('Готово');
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Не удалось выполнить действие.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="seller-form">
      {fields.map((field) =>
        field.options ? (
          <Select
            key={field.name}
            id={id + field.name}
            name={field.name}
            label={field.label}
            required={field.required}
          >
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            key={field.name}
            id={id + field.name}
            name={field.name}
            label={field.label}
            type={field.type ?? 'text'}
            required={field.required}
            maxLength={field.type === 'password' ? 128 : 254}
            autoComplete={
              field.type === 'password' ? 'new-password' : undefined
            }
          />
        ),
      )}
      <Input
        id={id + 'reason'}
        name="reason"
        label="Причина действия"
        required
        minLength={3}
        maxLength={2000}
      />
      <Button disabled={busy}>{busy ? 'Выполняем…' : label}</Button>
      <p role="status">{message}</p>
    </form>
  );
}
