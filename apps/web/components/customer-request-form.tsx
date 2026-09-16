'use client';
import { useEffect, useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button, Input, Select } from './ui';
import { record, string } from '../lib/catalogue/contract';
import { REQUEST_PRIVACY_VERSION } from '../lib/customer-requests';
import type { Product } from '../lib/catalogue/model';
export function CustomerRequestForm({
  product,
  selected,
}: {
  product: Product;
  selected: string;
}) {
  const id = useId();
  const [message, setMessage] = useState('');
  const [challenge, setChallenge] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    void fetch(
      '/api/requests?productId=' + encodeURIComponent(product.id ?? ''),
      { signal: controller.signal, cache: 'no-store' },
    )
      .then(async (r) => {
        if (!r.ok)
          throw new Error('Форма временно недоступна. Попробуйте позже.');
        const data = record(await r.json());
        if (controller.signal.aborted) return;
        if (data.policyVersion !== REQUEST_PRIVACY_VERSION)
          throw new Error(
            'Обновите страницу: условия обработки данных изменились.',
          );
        setChallenge(string(data.challenge));
        timer = setTimeout(() => setReady(true), 2100);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setMessage(
            e instanceof Error ? e.message : 'Не удалось подготовить форму.',
          );
      });
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [product.id, refresh]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ready || busy) return;
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-qrg-client': 'web' },
        body: JSON.stringify({
          name: data.get('name'),
          phone: data.get('phone'),
          productId: product.id,
          variantId: data.get('variantId') || null,
          quantity: Number(data.get('quantity')),
          pickupPreference: data.get('pickupPreference') || null,
          comment: data.get('comment') || null,
          privacyConsent: data.get('privacyConsent') === 'on',
          policyVersion: REQUEST_PRIVACY_VERSION,
          website: data.get('website'),
          challenge,
        }),
      });
      if (!response.ok) {
        const text: Record<number, string> = {
          400: 'Проверьте поля. Срок действия формы мог истечь — обновите её.',
          403: 'Не удалось проверить отправку. Обновите страницу.',
          404: 'Товар сейчас недоступен для заявок.',
          409: 'Эта форма уже использована. Обновите её.',
          429: 'Слишком много обращений. Попробуйте через 15 минут.',
          503: 'Приём заявок временно недоступен.',
        };
        throw new Error(
          text[response.status] ??
            'Не удалось отправить. Повторите попытку: дубликат не создастся.',
        );
      }
      setSuccess(true);
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : 'Нет связи. Повторите отправку.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (success)
    return (
      <div className="request-success" role="status">
        <h3>Заявка отправлена продавцу</h3>
        <p>
          Продавец свяжется с вами по указанному телефону. Это обращение, а не
          подтверждение оплаты или резерв товара.
        </p>
      </div>
    );
  return (
    <form
      className="seller-form request-form"
      onSubmit={submit}
      aria-describedby={id + 'notice'}
    >
      <h3>Заявка продавцу</h3>
      <p id={id + 'notice'}>
        Регистрация не требуется. Оплата и получение товара обсуждаются напрямую
        с магазином.
      </p>
      <Input
        id={id + 'name'}
        name="name"
        label="Имя"
        required
        maxLength={100}
        autoComplete="given-name"
      />
      <Input
        id={id + 'phone'}
        name="phone"
        label="Телефон в международном формате"
        type="tel"
        placeholder="+7 (700) 000-00-00"
        required
        maxLength={40}
        autoComplete="tel"
      />
      <Select
        id={id + 'variant'}
        name="variantId"
        label="Вариант"
        defaultValue={selected}
      >
        <option value="">Уточнить у продавца</option>
        {product.variants.map((v) => (
          <option key={v.id} value={v.id}>
            {[v.size, v.color].filter(Boolean).join(' · ') ||
              'Стандартный вариант'}
            {v.available ? '' : ' · нет в наличии'}
          </option>
        ))}
      </Select>
      <Input
        id={id + 'quantity'}
        name="quantity"
        label="Количество"
        type="number"
        min={1}
        max={99}
        step={1}
        defaultValue={1}
        required
      />
      <Select
        id={id + 'pickup'}
        name="pickupPreference"
        label="Получение (необязательно)"
      >
        <option value="">Уточнить у продавца</option>
        <option value="SHOP_PICKUP">Забрать в магазине</option>
        <option value="DISCUSS_WITH_SELLER">Обсудить с продавцом</option>
      </Select>
      <label className="field" htmlFor={id + 'comment'}>
        <span>Комментарий (необязательно)</span>
        <textarea
          id={id + 'comment'}
          name="comment"
          maxLength={1000}
          rows={4}
        />
      </label>
      <div className="request-honeypot" aria-hidden="true">
        <label htmlFor={id + 'website'}>Не заполняйте это поле</label>
        <input
          id={id + 'website'}
          name="website"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
      <label className="request-consent">
        <input name="privacyConsent" type="checkbox" required />{' '}
        <span>
          Согласен на обработку указанных данных QRG MARKET и их передачу
          магазину «{product.shopDetails?.name}» для ответа на эту заявку.{' '}
          <Link
            href="/privacy/requests"
            target="_blank"
            rel="noopener noreferrer"
          >
            Условия обработки данных
          </Link>
          .
        </span>
      </label>
      <Button disabled={!ready || busy}>
        {busy
          ? 'Отправляем…'
          : ready
            ? 'Отправить заявку'
            : 'Подготавливаем форму…'}
      </Button>
      <p role="status">{message}</p>
      {message && (
        <Button
          variant="quiet"
          type="button"
          disabled={busy}
          onClick={() => {
            setMessage('');
            setReady(false);
            setRefresh((n) => n + 1);
          }}
        >
          Обновить форму
        </Button>
      )}
    </form>
  );
}
