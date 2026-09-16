'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Select } from '../ui';
import { mutate } from './forms';
import { array, record, string } from '../../lib/catalogue/contract';
import { draftStorage } from '../../lib/seller/draft-storage';

type Option = { id: string; name: string };
type Variant = {
  size: string;
  color: string;
  sku: string;
  priceOverride: string;
  available: boolean;
};
type FormState = {
  name: string;
  categoryId: string;
  brandId: string;
  description: string;
  basePrice: string;
  oldPrice: string;
  available: boolean;
  variants: Variant[];
};
type LocalDraft = {
  id: string;
  form: FormState;
  files: File[];
  productId?: string;
};
const empty: FormState = {
  name: '',
  categoryId: '',
  brandId: '',
  description: '',
  basePrice: '',
  oldPrice: '',
  available: true,
  variants: [],
};
const steps = [
  'Фото',
  'Информация',
  'Цена',
  'Варианты',
  'Наличие',
  'Предпросмотр',
];
type SavedDraft = {
  id: string;
  version: number;
  content: Record<string, unknown>;
  productId: string | null;
};
function restore(value: Record<string, unknown>): FormState {
  const text = (key: string) => (value[key] == null ? '' : String(value[key]));
  const variants = Array.isArray(value.variants)
    ? array(value.variants).map(record)
    : [];
  const simple =
    variants.length === 1 && !variants[0]?.size && !variants[0]?.color;
  return {
    name: text('name'),
    categoryId: text('categoryId'),
    brandId: text('brandId'),
    description: text('description'),
    basePrice: text('basePrice'),
    oldPrice: text('oldPrice'),
    available: variants[0]?.available !== false,
    variants: simple
      ? []
      : variants.map((v) => ({
          size: String(v.size ?? ''),
          color: String(v.color ?? ''),
          sku: String(v.sku ?? ''),
          priceOverride: v.priceOverride == null ? '' : String(v.priceOverride),
          available: v.available !== false,
        })),
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => JSON.stringify(key) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
function content(form: FormState) {
  return {
    ...(form.name.trim() ? { name: form.name.trim() } : {}),
    ...(form.categoryId ? { categoryId: form.categoryId } : {}),
    brandId: form.brandId || null,
    description: form.description,
    ...(form.basePrice !== '' ? { basePrice: Number(form.basePrice) } : {}),
    oldPrice: form.oldPrice === '' ? null : Number(form.oldPrice),
    variants: form.variants.length
      ? form.variants.map((v) => ({
          size: v.size || null,
          color: v.color || null,
          sku: v.sku || null,
          priceOverride:
            v.priceOverride === '' ? null : Number(v.priceOverride),
          available: v.available,
        }))
      : [{ available: form.available }],
  };
}
export function ProductEditor({
  shopId,
  userId,
  csrf,
  categories,
  brands,
  shopStatus,
  savedDraft,
}: {
  shopId: string;
  userId: string;
  csrf: string;
  categories: Option[];
  brands: Option[];
  shopStatus: string;
  savedDraft?: SavedDraft;
}) {
  const [form, setForm] = useState<FormState>(() =>
    savedDraft ? restore(savedDraft.content) : empty,
  );
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [mode, setMode] = useState<'quick' | 'full'>('quick');
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [dirty, setDirty] = useState(false);
  const [retry, setRetry] = useState(0);
  const [done, setDone] = useState<{
    id: string;
    slug: string;
    published: boolean;
  }>();
  const [existingProductId, setExistingProductId] = useState<string>();
  const id = useRef('');
  const version = useRef(0);
  const lastSaved = useRef('');
  const latest = useRef('');
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const product = useRef<string | undefined>(undefined);
  const storageKey = 'product:' + userId + ':' + shopId;
  const base = 'shops/' + shopId;
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const stored = await draftStorage<LocalDraft | null>(storageKey);
        const local =
          stored && (!savedDraft || stored.id === savedDraft.id)
            ? stored
            : null;
        if (!active) return;
        id.current = savedDraft?.id ?? local?.id ?? crypto.randomUUID();
        if (local) {
          setForm(local.form);
          setFiles(local.files);
          product.current = local.productId;
        }
        const response = await fetch(
          '/api/seller/' + base + '/product-drafts/' + id.current,
        );
        if (response.ok) {
          const draft = record(await response.json());
          version.current = Number(draft.version);
          if (typeof draft.productId === 'string')
            product.current = draft.productId;
        } else if (response.status !== 404)
          throw new Error(
            'Не удалось загрузить черновик. Проверьте соединение.',
          );
        if (active) {
          setExistingProductId(product.current);
          setReady(true);
        }
      } catch (error) {
        if (active) {
          setMessage(
            error instanceof Error ? error.message : 'Ошибка загрузки',
          );
          id.current ||= crypto.randomUUID();
          setReady(true);
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [base, storageKey, savedDraft]);
  useEffect(() => {
    let active = true;
    const readers: FileReader[] = [];
    void Promise.all(
      files.map(
        (file) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            readers.push(reader);
            reader.onload = () =>
              resolve(typeof reader.result === 'string' ? reader.result : '');
            reader.onerror = () =>
              reject(new Error('Не удалось прочитать фотографию.'));
            reader.readAsDataURL(file);
          }),
      ),
    )
      .then((urls) => {
        if (active) setPreviews(urls);
      })
      .catch(() => {
        if (active) setMessage('Не удалось прочитать фотографию.');
      });
    return () => {
      active = false;
      readers.forEach((reader) => {
        if (reader.readyState === FileReader.LOADING) reader.abort();
      });
    };
  }, [files]);
  useEffect(() => {
    if (!ready || done) return;
    let active = true;
    void draftStorage(storageKey, {
      id: id.current,
      form,
      files,
      ...(product.current ? { productId: product.current } : {}),
    }).catch((error) => {
      if (active)
        setMessage(
          error instanceof Error
            ? error.message
            : 'Ошибка локального сохранения',
        );
    });
    return () => {
      active = false;
    };
  }, [form, files, ready, done, storageKey]);
  const save = useCallback(
    async (snapshot: string) => {
      if (product.current || snapshot === lastSaved.current) return;
      const operation = queue.current
        .catch(() => undefined)
        .then(async () => {
          if (snapshot === lastSaved.current) return;
          setSaveStatus('Сохраняем…');
          let result: Record<string, unknown>;
          try {
            result = record(
              await mutate(
                base + '/product-drafts/' + id.current,
                'PUT',
                {
                  version: version.current,
                  content: JSON.parse(snapshot) as unknown,
                },
                csrf,
              ),
            );
          } catch (error) {
            // A lost response may follow a successful commit. Accept only an exact content match;
            // a different revision from another tab must never be overwritten silently.
            const response = await fetch(
              '/api/seller/' + base + '/product-drafts/' + id.current,
            );
            if (!response.ok) throw error;
            result = record(await response.json());
            if (
              canonical(result.content) !==
              canonical(JSON.parse(snapshot) as unknown)
            )
              throw error;
          }
          version.current = Number(result.version);
          lastSaved.current = snapshot;
          setSaveStatus('Сохранено');
          setDirty(latest.current !== snapshot);
        });
      queue.current = operation;
      await operation;
    },
    [base, csrf],
  );
  useEffect(() => {
    if (!ready || done || product.current) return;
    const snapshot = JSON.stringify(content(form));
    latest.current = snapshot;
    setDirty(snapshot !== lastSaved.current);
    const timer = setTimeout(() => {
      void save(snapshot).catch(() => {
        setSaveStatus('Не удалось сохранить');
        setDirty(true);
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [form, ready, done, retry, save]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    const navigate = (e: MouseEvent) => {
      if (
        e.target instanceof Element &&
        e.target.closest('a[href]') &&
        !window.confirm('Изменения ещё сохраняются. Покинуть страницу?')
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', navigate, true);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', navigate, true);
    };
  }, [dirty, busy]);
  function choose(incoming: FileList | null) {
    if (!incoming) return;
    const additions = Array.from(incoming);
    if (
      files.length + additions.length > 10 ||
      additions.some(
        (f) =>
          !['image/jpeg', 'image/png', 'image/webp'].includes(f.type) ||
          f.size > 10 * 1024 * 1024,
      )
    ) {
      setMessage(
        'Можно добавить до 10 фото JPEG, PNG или WEBP, каждое до 10 MB.',
      );
      return;
    }
    setFiles((previous) => [...previous, ...additions]);
    setMessage('');
  }
  async function finish(publish: boolean) {
    if (busy) return;
    if (!form.name.trim() || !form.categoryId || form.basePrice === '') {
      setMessage('Укажите название, категорию и цену.');
      return;
    }
    if (publish && !files.length && !product.current) {
      setMessage('Добавьте хотя бы одну фотографию.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await queue.current.catch(() => undefined);
      await save(JSON.stringify(content(form)));
      const created = record(
        await mutate(
          base + '/product-drafts/' + id.current + '/materialize',
          'POST',
          {},
          csrf,
        ),
      );
      product.current = string(created.id);
      setExistingProductId(product.current);
      await draftStorage(storageKey, {
        id: id.current,
        form,
        files,
        productId: product.current,
      });
      for (let i = 0; i < files.length; i++) {
        const body = new FormData();
        body.set('file', files[i]!);
        setMessage('Загружаем фото ' + (i + 1) + ' из ' + files.length + '…');
        await mutate(
          base + '/products/' + product.current + '/images',
          'POST',
          body,
          csrf,
        );
        await draftStorage(storageKey, {
          id: id.current,
          form,
          files: files.slice(i + 1),
          productId: product.current,
        });
      }
      if (publish)
        await mutate(
          base + '/product-actions',
          'POST',
          { ids: [product.current], action: 'PUBLISH' },
          csrf,
        );
      await draftStorage(storageKey, null);
      setFiles([]);
      setDirty(false);
      setMessage('');
      setDone({
        id: product.current,
        slug: string(created.slug),
        published: publish,
      });
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Не удалось сохранить товар. Попробуйте ещё раз.',
      );
    } finally {
      setBusy(false);
    }
  }
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  const visible = (n: number) =>
    mode === 'quick' ? [0, 1, 2, 4].includes(n) : step === n;
  if (done)
    return (
      <div className="seller-form">
        <h2>{done.published ? 'Товар опубликован' : 'Черновик сохранён'}</h2>
        {shopStatus !== 'ACTIVE' && (
          <p>
            В каталоге товар появится после проверки магазина и активации
            подписки. Сейчас вы можете продолжать оформление.
          </p>
        )}
        <a
          className="button button-primary"
          href={'/seller/' + shopId + '/products/new'}
        >
          Добавить ещё товар
        </a>
        <Link
          className="button button-secondary"
          href={'/seller/' + shopId + '/products/' + done.id}
        >
          Дополнить информацию
        </Link>
        {shopStatus === 'ACTIVE' && done.published && (
          <Link href={'/product/' + done.slug}>Посмотреть товар</Link>
        )}
      </div>
    );
  return (
    <div className="product-editor">
      <div className="seller-row">
        <Button
          type="button"
          variant={mode === 'quick' ? 'primary' : 'secondary'}
          onClick={() => setMode('quick')}
        >
          Быстрое добавление
        </Button>
        <Button
          type="button"
          variant={mode === 'full' ? 'primary' : 'secondary'}
          onClick={() => setMode('full')}
        >
          Полное добавление
        </Button>
      </div>
      {existingProductId ? (
        <div role="status">
          <p>Товар уже создан. Продолжите редактирование его карточки.</p>
          <Link href={'/seller/' + shopId + '/products/' + existingProductId}>
            Открыть сохранённый товар
          </Link>
        </div>
      ) : null}
      {mode === 'full' && (
        <nav aria-label="Шаги добавления товара" className="editor-steps">
          {steps.map((label, index) => (
            <button
              key={label}
              type="button"
              aria-current={step === index ? 'step' : undefined}
              onClick={() => setStep(index)}
            >
              {index + 1}. {label}
            </button>
          ))}
        </nav>
      )}
      <fieldset
        disabled={!ready || busy || Boolean(existingProductId)}
        className="editor-fields"
      >
        {visible(0) && (
          <section>
            <h2>Фотографии</h2>
            <p>
              Добавьте 3–5 качественных фотографий товара. Первая фотография
              будет основной.
            </p>
            <div
              className="photo-drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                choose(e.dataTransfer.files);
              }}
            >
              <Input
                id="editor-photos"
                label="Выбрать фото или перетащить сюда"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(e) => choose(e.target.files)}
              />
              <Input
                id="editor-camera"
                label="Сделать фото"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={(e) => choose(e.target.files)}
              />
            </div>
            <div className="seller-images">
              {previews.map((src, i) => (
                <div key={src}>
                  <Image
                    src={src}
                    alt={'Фотография товара ' + (i + 1)}
                    width={160}
                    height={160}
                    unoptimized
                  />
                  <span>{i === 0 ? 'Главное фото' : 'Фото ' + (i + 1)}</span>
                  <Button
                    type="button"
                    variant="quiet"
                    disabled={i === 0}
                    onClick={() =>
                      setFiles((previous) => [
                        previous[i]!,
                        ...previous.filter((_, j) => j !== i),
                      ])
                    }
                  >
                    Сделать главным
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() =>
                      setFiles((previous) => previous.filter((_, j) => j !== i))
                    }
                  >
                    Удалить
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}
        {visible(1) && (
          <section className="seller-form">
            <h2>О товаре</h2>
            <Input
              id="editor-name"
              label="Название товара"
              maxLength={200}
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
            />
            <Select
              id="editor-category"
              label="Категория"
              value={form.categoryId}
              onChange={(e) => update('categoryId', e.target.value)}
            >
              <option value="">Выберите категорию</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            {mode === 'full' && (
              <>
                <Select
                  id="editor-brand"
                  label="Бренд — необязательно"
                  value={form.brandId}
                  onChange={(e) => update('brandId', e.target.value)}
                >
                  <option value="">Без бренда</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
                <label className="field" htmlFor="editor-description">
                  Описание — необязательно
                  <textarea
                    id="editor-description"
                    maxLength={10000}
                    rows={4}
                    value={form.description}
                    onChange={(e) => update('description', e.target.value)}
                  />
                </label>
              </>
            )}
          </section>
        )}
        {visible(2) && (
          <section className="seller-form">
            <h2>Цена</h2>
            <Input
              id="editor-price"
              label="Цена, ₸"
              type="number"
              inputMode="decimal"
              min={0}
              max={99999999.99}
              step="0.01"
              value={form.basePrice}
              onChange={(e) => update('basePrice', e.target.value)}
            />
            {mode === 'full' && (
              <Input
                id="editor-old-price"
                label="Старая цена — необязательно, ₸"
                type="number"
                inputMode="decimal"
                min={0}
                max={99999999.99}
                step="0.01"
                value={form.oldPrice}
                onChange={(e) => update('oldPrice', e.target.value)}
              />
            )}
          </section>
        )}
        {visible(3) && (
          <section className="seller-form">
            <h2>Размеры и цвета — необязательно</h2>
            {form.variants.map((v, index) => (
              <fieldset key={index}>
                <legend>Вариант {index + 1}</legend>
                {(['size', 'color', 'sku', 'priceOverride'] as const).map(
                  (key) => (
                    <Input
                      key={key}
                      id={'variant-' + index + key}
                      label={
                        {
                          size: 'Размер',
                          color: 'Цвет',
                          sku: 'Внутренний код товара — необязательно',
                          priceOverride: 'Цена варианта, ₸ — необязательно',
                        }[key]
                      }
                      value={v[key]}
                      maxLength={key === 'sku' ? 100 : 40}
                      onChange={(e) =>
                        update(
                          'variants',
                          form.variants.map((variant, i) =>
                            i === index
                              ? { ...variant, [key]: e.target.value }
                              : variant,
                          ),
                        )
                      }
                    />
                  ),
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={v.available}
                    onChange={(e) =>
                      update(
                        'variants',
                        form.variants.map((variant, i) =>
                          i === index
                            ? { ...variant, available: e.target.checked }
                            : variant,
                        ),
                      )
                    }
                  />{' '}
                  В наличии
                </label>
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() =>
                    update(
                      'variants',
                      form.variants.filter((_, i) => i !== index),
                    )
                  }
                >
                  Удалить вариант
                </Button>
              </fieldset>
            ))}
            <Button
              type="button"
              variant="secondary"
              disabled={form.variants.length >= 100}
              onClick={() =>
                update('variants', [
                  ...form.variants,
                  {
                    size: '',
                    color: '',
                    sku: '',
                    priceOverride: '',
                    available: true,
                  },
                ])
              }
            >
              Добавить размер / цвет
            </Button>
          </section>
        )}
        {visible(4) && (
          <section>
            <h2>Наличие</h2>
            <Select
              id="editor-availability"
              label="Наличие товара"
              value={form.available ? 'yes' : 'no'}
              onChange={(e) => update('available', e.target.value === 'yes')}
            >
              <option value="yes">В наличии</option>
              <option value="no">Нет в наличии</option>
            </Select>
            <p>
              Если добавлены варианты, наличие указывается отдельно для каждого.
              Магазин отвечает за актуальность наличия.
            </p>
          </section>
        )}
        {visible(5) && (
          <section>
            <h2>Так товар увидит покупатель</h2>
            <article className="editor-preview">
              {previews[0] && (
                <Image
                  src={previews[0]}
                  alt={form.name || 'Товар'}
                  width={320}
                  height={320}
                  unoptimized
                />
              )}
              <h3>{form.name || 'Название товара'}</h3>
              <strong>
                {Number(form.basePrice).toLocaleString('ru-RU')} ₸
              </strong>
              <p>{form.description}</p>
              <p>{form.available ? 'В наличии' : 'Нет в наличии'}</p>
            </article>
          </section>
        )}
        <div className="seller-row">
          {mode === 'full' && step > 0 && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setStep(step - 1)}
            >
              Назад
            </Button>
          )}
          {mode === 'full' && step < 5 ? (
            <Button type="button" onClick={() => setStep(step + 1)}>
              Далее
            </Button>
          ) : (
            <Button type="button" onClick={() => void finish(true)}>
              Опубликовать
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void save(JSON.stringify(content(form))).catch(() =>
                setSaveStatus('Не удалось сохранить'),
              )
            }
          >
            Сохранить черновик
          </Button>
        </div>
      </fieldset>
      <p role="status">{saveStatus}</p>
      {saveStatus === 'Не удалось сохранить' && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => setRetry(retry + 1)}
        >
          Повторить сохранение
        </Button>
      )}
      <p role="alert">{message}</p>
      {busy && <progress aria-label="Сохранение товара" />}
    </div>
  );
}
