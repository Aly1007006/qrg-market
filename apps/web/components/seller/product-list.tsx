'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, EmptyState } from '../ui';
import { mutate } from './forms';
import { record, string } from '../../lib/catalogue/contract';

export type SellerProductRow = {
  id: string;
  name: string;
  basePrice: number;
  categoryName: string;
  available: boolean;
  status: string;
  views: number;
  updatedAt: string;
  imageId: string | null;
};
const statuses: Record<string, string> = {
  DRAFT: 'Черновик / скрыт',
  PUBLISHED: 'Опубликован',
  ARCHIVED: 'В архиве',
};
export function ProductList({
  rows,
  shopId,
  csrf,
}: {
  rows: SellerProductRow[];
  shopId: string;
  csrf: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const router = useRouter();
  const base = 'shops/' + shopId;
  const href = '/seller/' + shopId;
  async function action(ids: string[], type: string, available = true) {
    if (!ids.length || busy) return;
    if (
      ['HIDE', 'ARCHIVE'].includes(type) &&
      !window.confirm(
        type === 'ARCHIVE'
          ? 'Переместить выбранные товары в архив? История обращений сохранится.'
          : 'Скрыть выбранные товары от покупателей?',
      )
    )
      return;
    setBusy(true);
    setMessage('');
    try {
      await mutate(
        base + '/product-actions',
        'POST',
        { ids, action: type, available },
        csrf,
      );
      setSelected([]);
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Не удалось изменить товары.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function duplicate(id: string) {
    setBusy(true);
    setMessage('');
    try {
      const copy = record(
        await mutate(base + '/products/' + id + '/duplicate', 'POST', {}, csrf),
      );
      router.push(href + '/products/' + string(copy.id));
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Не удалось создать копию.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (!rows.length)
    return (
      <EmptyState
        title="У вас пока нет товаров по этим условиям"
        description="Добавьте первый товар или измените фильтры. В каталоге товары появятся после проверки магазина и активации подписки."
      />
    );
  return (
    <div>
      <fieldset disabled={busy} className="editor-fields">
        <div className="seller-row">
          <label>
            <input
              type="checkbox"
              checked={selected.length === rows.length}
              onChange={(e) =>
                setSelected(e.target.checked ? rows.map((row) => row.id) : [])
              }
            />{' '}
            Выбрать все на странице
          </label>
          <span>Выбрано: {selected.length}</span>
        </div>
        {selected.length > 0 && (
          <div className="seller-row">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void action(selected, 'HIDE')}
            >
              Скрыть
            </Button>
            <Button
              type="button"
              onClick={() => void action(selected, 'PUBLISH')}
            >
              Опубликовать
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void action(selected, 'AVAILABILITY', true)}
            >
              В наличии
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void action(selected, 'AVAILABILITY', false)}
            >
              Нет в наличии
            </Button>
          </div>
        )}
        <div className="operations-products">
          {rows.map((row) => (
            <article key={row.id} className="operations-product">
              <label className="product-select">
                <input
                  type="checkbox"
                  aria-label={'Выбрать ' + row.name}
                  checked={selected.includes(row.id)}
                  onChange={(e) =>
                    setSelected((previous) =>
                      e.target.checked
                        ? [...previous, row.id]
                        : previous.filter((id) => id !== row.id),
                    )
                  }
                />
              </label>
              <Link href={href + '/products/' + row.id}>
                {row.imageId ? (
                  <Image
                    src={
                      '/api/seller/' +
                      base +
                      '/products/' +
                      row.id +
                      '/images/' +
                      row.imageId +
                      '/content'
                    }
                    width={96}
                    height={96}
                    alt={row.name}
                    unoptimized
                  />
                ) : (
                  <span className="product-no-photo">Добавьте фото</span>
                )}
              </Link>
              <div>
                <Link href={href + '/products/' + row.id}>
                  <h3>{row.name}</h3>
                </Link>
                <strong>{row.basePrice.toLocaleString('ru-RU')} ₸</strong>
                <p>
                  {row.categoryName} ·{' '}
                  {row.available ? 'В наличии' : 'Нет в наличии'} ·{' '}
                  {statuses[row.status]}
                </p>
                <p className="muted">
                  Просмотры за 30 дней: {row.views} · Изменено{' '}
                  {new Date(row.updatedAt).toLocaleDateString('ru-RU')}
                </p>
                <div className="seller-row">
                  <Link href={href + '/products/' + row.id}>Редактировать</Link>
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() => void duplicate(row.id)}
                  >
                    Дублировать
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() =>
                      void action(
                        [row.id],
                        row.status === 'PUBLISHED' ? 'HIDE' : 'PUBLISH',
                      )
                    }
                  >
                    {row.status === 'PUBLISHED' ? 'Скрыть' : 'Опубликовать'}
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() => void action([row.id], 'ARCHIVE')}
                  >
                    Убрать в архив
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </fieldset>
      <p role="alert">{message}</p>
    </div>
  );
}
