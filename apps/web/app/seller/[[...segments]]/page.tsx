import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sellerRead } from '../../../lib/seller/server';
import { array, record, string } from '../../../lib/catalogue/contract';
import { uuidPattern } from '../../../lib/seller/boundary';
import { SellerForm, Availability } from '../../../components/seller/forms';
import { Badge, EmptyState } from '../../../components/ui';
import { SellerRequests } from '../../../components/seller/requests';
import { SellerVerification } from '../../../components/seller/verification';
import { SellerSubscription } from '../../../components/seller/subscription';
import { SellerAnalytics } from '../../../components/seller/analytics';
import { ProductEditor } from '../../../components/seller/product-editor';
import { SellerProducts } from '../../../components/seller/products';
import { Academy } from '../../../components/seller/academy';
import {
  SellerOnboarding,
  ShopBranding,
} from '../../../components/seller/onboarding';
import { ImageManager } from '../../../components/seller/image-manager';

const sections = [
  ['', 'Обзор'],
  ['products', 'Товары'],
  ['requests', 'Заявки'],
  ['statistics', 'Статистика'],
  ['subscription', 'Подписка'],
  ['shop', 'Магазин'],
  ['employees', 'Сотрудники'],
  ['settings', 'Настройки'],
  ['academy', 'Обучение'],
] as const;
const roles = [
  { value: 'SHOP_MANAGER', label: 'Менеджер' },
  { value: 'SHOP_EMPLOYEE', label: 'Сотрудник' },
];
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ segments?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const segments = (await params).segments ?? [];
  if (
    segments.length > 3 ||
    (segments[0] && !new RegExp(`^${uuidPattern}$`).test(segments[0]))
  )
    notFound();
  const me = record(await sellerRead('auth/me'));
  const csrf = string(me.csrfToken);
  const user = record(me.user);
  if (!segments[0]) {
    const shops = array(await sellerRead('shops?limit=100')).map(record);
    return (
      <>
        <p className="eyebrow">QRG BUSINESS</p>
        <h1>Ваши магазины</h1>
        <p>{string(user.email)}</p>
        <div className="seller-list">
          {shops.map((shop) => (
            <Link key={string(shop.id)} href={'/seller/' + string(shop.id)}>
              <h2>{string(shop.name)}</h2>
              <Badge>{string(shop.status)}</Badge>
            </Link>
          ))}
        </div>
        {!shops.length && (
          <p>
            Создайте магазин, чтобы начать работу. До проверки он не появится в
            каталоге.
          </p>
        )}
        <h2>Новый магазин</h2>
        <SellerForm
          csrf={csrf}
          path="shops"
          fields={[
            {
              name: 'name',
              label: 'Название магазина',
              required: true,
              maxLength: 120,
            },
          ]}
          label="Создать магазин"
        />
      </>
    );
  }
  const shopId = segments[0];
  const section = segments[1] ?? '';
  const detail = segments[2];
  if (
    !sections.some(([key]) => key === section) ||
    (detail && !['products', 'requests'].includes(section)) ||
    (detail === 'new' && section !== 'products') ||
    (detail && detail !== 'new' && !new RegExp(`^${uuidPattern}$`).test(detail))
  )
    notFound();
  const shop = record(await sellerRead('shops/' + shopId));
  const base = 'shops/' + shopId;
  const href = '/seller/' + shopId;
  let content: React.ReactNode;
  if (section === 'academy') content = <Academy shopId={shopId} />;
  else if (section === '')
    content = (
      <SellerOnboarding shopId={shopId} csrf={csrf} role={string(shop.role)} />
    );
  else if (section === 'statistics')
    content = (
      <SellerAnalytics
        shopId={shopId}
        role={string(shop.role)}
        query={await searchParams}
      />
    );
  else if (section === 'requests')
    content = (
      <SellerRequests
        shopId={shopId}
        {...(detail ? { detail } : {})}
        csrf={csrf}
        query={await searchParams}
      />
    );
  else if (section === 'subscription')
    content = (
      <SellerSubscription
        shopId={shopId}
        csrf={csrf}
        role={string(shop.role)}
        query={await searchParams}
      />
    );
  else if (section === 'settings') {
    const sessions = array(await sellerRead('auth/sessions')).map(record);
    content = (
      <>
        <h2>Безопасность аккаунта</h2>
        <p>Email: {string(user.email)}</p>
        <p>
          Ваш ID для добавления в магазин: <code>{string(user.id)}</code>
        </p>
        <SellerForm
          path="auth/session/rotate"
          csrf={csrf}
          label="Обновить текущую сессию"
        />
        {sessions.map((s) => (
          <div key={string(s.id)} className="seller-row">
            <span>
              Сессия до {new Date(string(s.expiresAt)).toLocaleString('ru-RU')}
            </span>
            <SellerForm
              path={'auth/sessions/' + string(s.id)}
              method="DELETE"
              csrf={csrf}
              label="Завершить сессию"
            />
          </div>
        ))}
        <SellerForm
          path="auth/sessions/revoke-all"
          csrf={csrf}
          label="Выйти на всех устройствах"
          redirectTo="/seller/login"
        />
        <SellerForm
          path="auth/logout"
          csrf={csrf}
          label="Выйти"
          redirectTo="/seller/login"
        />
      </>
    );
  } else if (
    (section === 'shop' || section === 'employees') &&
    shop.role !== 'SHOP_OWNER'
  ) {
    content = (
      <EmptyState
        title="Доступно владельцу магазина"
        description="Ваша роль позволяет управлять товарами и наличием. Изменения магазина и сотрудников выполняет владелец."
      />
    );
  } else if (section === 'shop') {
    const profile = record(await sellerRead(base + '/profile'));
    const location = profile.location ? record(profile.location) : {};
    const contacts = profile.contacts ? record(profile.contacts) : {};
    const text = (value: unknown) => (value == null ? '' : string(value));
    content = (
      <>
        <p>
          Статус: <Badge>{string(shop.status)}</Badge>. Публикация зависит от
          проверки и подписки.
        </p>
        <SellerVerification
          shopId={shopId}
          status={string(shop.status)}
          csrf={csrf}
        />
        <ShopBranding
          shopId={shopId}
          csrf={csrf}
          editable={
            !['PENDING_VERIFICATION', 'VERIFIED', 'ACTIVE'].includes(
              string(shop.status),
            )
          }
        />
        <fieldset
          disabled={['PENDING_VERIFICATION', 'VERIFIED', 'ACTIVE'].includes(
            string(shop.status),
          )}
          className="verification-fields"
        >
          <SellerForm
            path={base}
            method="PATCH"
            csrf={csrf}
            fields={[
              {
                name: 'name',
                label: 'Название',
                value: string(shop.name),
                required: true,
                maxLength: 120,
              },
            ]}
          />
          <h2>Адрес и контакты</h2>
          <SellerForm
            path={base + '/location'}
            method="PUT"
            csrf={csrf}
            numeric={['latitude', 'longitude']}
            fields={[
              {
                name: 'address',
                label: 'Адрес',
                value: text(location.address),
                required: true,
                maxLength: 300,
              },
              {
                name: 'mall',
                label: 'Торговый центр',
                value: text(location.mall),
                nullable: true,
                maxLength: 150,
              },
              {
                name: 'twoGisUrl',
                label: 'Официальная карточка 2GIS',
                value: text(location.twoGisUrl),
                nullable: true,
                maxLength: 300,
              },
              {
                name: 'latitude',
                label: 'Широта (необязательно)',
                value:
                  location.latitude == null ? '' : Number(location.latitude),
              },
              {
                name: 'longitude',
                label: 'Долгота (необязательно)',
                value:
                  location.longitude == null ? '' : Number(location.longitude),
              },
            ]}
          />
          <SellerForm
            path={base + '/contacts'}
            method="PUT"
            csrf={csrf}
            fields={[
              {
                name: 'phone',
                label: 'Телефон',
                value: text(contacts.phone),
                nullable: true,
                maxLength: 40,
              },
              {
                name: 'whatsappPhone',
                label: 'WhatsApp',
                value: text(contacts.whatsappPhone),
                nullable: true,
                maxLength: 40,
              },
            ]}
          />
        </fieldset>
      </>
    );
  } else if (section === 'employees') {
    const members = array(await sellerRead(base + '/members?limit=100')).map(
      record,
    );
    content = (
      <>
        <p>
          Управление сотрудниками доступно владельцу. Пользователь сначала
          регистрируется и сообщает свой ID из настроек.
        </p>
        {members.map((m) => (
          <div className="seller-row" key={string(m.id)}>
            <div>
              <code>{string(m.userId)}</code>
              <p>{string(m.role)}</p>
            </div>
            {m.role !== 'SHOP_OWNER' && (
              <>
                <SellerForm
                  path={base + '/members/' + string(m.id)}
                  method="PATCH"
                  csrf={csrf}
                  fields={[
                    {
                      name: 'role',
                      label: 'Роль',
                      value: string(m.role),
                      options: roles,
                    },
                  ]}
                />
                <SellerForm
                  path={base + '/members/' + string(m.id)}
                  method="DELETE"
                  csrf={csrf}
                  label="Удалить из магазина"
                />
              </>
            )}
          </div>
        ))}
        <h2>Добавить сотрудника</h2>
        <SellerForm
          path={base + '/members'}
          csrf={csrf}
          fields={[
            { name: 'userId', label: 'ID пользователя', required: true },
            { name: 'role', label: 'Роль', options: roles },
          ]}
        />
      </>
    );
  } else if (section === 'products' && detail) {
    const categories = array(await sellerRead('public/categories')).map((v) => {
      const c = record(v);
      return { id: string(c.id), name: string(c.name) };
    });
    if (detail === 'new') {
      const query = await searchParams;
      const draft =
        typeof query.draft === 'string' &&
        new RegExp(`^${uuidPattern}$`).test(query.draft)
          ? record(await sellerRead(base + '/product-drafts/' + query.draft))
          : undefined;
      content = (
        <ProductEditor
          {...(draft
            ? {
                savedDraft: {
                  id: string(draft.id),
                  version: Number(draft.version),
                  content: record(draft.content),
                  productId:
                    typeof draft.productId === 'string'
                      ? draft.productId
                      : null,
                },
              }
            : {})}
          shopId={shopId}
          userId={string(user.id)}
          shopStatus={string(shop.status)}
          csrf={csrf}
          categories={categories}
          brands={array(await sellerRead('public/brands?limit=100')).map(
            (value) => {
              const brand = record(value);
              return { id: string(brand.id), name: string(brand.name) };
            },
          )}
        />
      );
    } else {
      const brands = array(await sellerRead('public/brands?limit=100')).map(
        record,
      );
      const p = record(await sellerRead(base + '/products/' + detail));
      const path = base + '/products/' + detail;
      const variants = array(p.variants).map(record);
      const images = array(p.images).map(record);
      content = (
        <>
          <p>
            <Badge>{string(p.status)}</Badge>
          </p>
          <SellerForm
            path={path}
            method="PUT"
            csrf={csrf}
            numeric={['basePrice', 'oldPrice']}
            fields={[
              {
                name: 'brandId',
                label: 'Бренд — необязательно',
                value: p.brandId == null ? '' : string(p.brandId),
                nullable: true,
                options: [
                  { value: '', label: 'Без бренда' },
                  ...brands.map((b) => ({
                    value: string(b.id),
                    label: string(b.name),
                  })),
                ],
              },
              {
                name: 'name',
                label: 'Название',
                required: true,
                value: string(p.name),
                maxLength: 200,
              },
              {
                name: 'slug',
                type: 'hidden',
                label: 'Адрес товара',
                required: true,
                value: string(p.slug),
                maxLength: 120,
              },
              {
                name: 'description',
                label: 'Описание',
                value: string(p.description),
                maxLength: 10000,
              },
              {
                name: 'categoryId',
                label: 'Категория',
                value: string(p.categoryId),
                options: categories.map((c) => ({
                  value: c.id,
                  label: c.name,
                })),
              },
              {
                name: 'basePrice',
                label: 'Цена, ₸',
                type: 'number',
                value: Number(p.basePrice),
                required: true,
              },
              {
                name: 'oldPrice',
                label: 'Прежняя цена, ₸',
                type: 'number',
                value: p.oldPrice == null ? '' : Number(p.oldPrice),
              },
              {
                name: 'status',
                label: 'Статус',
                value: string(p.status),
                options: [
                  { value: 'DRAFT', label: 'Черновик' },
                  { value: 'PUBLISHED', label: 'Опубликован' },
                  { value: 'ARCHIVED', label: 'В архиве' },
                ],
              },
            ]}
          />
          <h2>Варианты и наличие</h2>
          <p>
            Магазин отвечает за актуальность наличия. QRG не резервирует
            складской остаток.
          </p>
          {variants.map((v) => (
            <div className="seller-row" key={string(v.id)}>
              <span>
                {[v.size, v.color, v.sku].filter(Boolean).join(' / ') ||
                  'Основной вариант'}
              </span>
              <Badge>{v.available ? 'В наличии' : 'Нет в наличии'}</Badge>
              <Availability
                path={path + '/variants/' + string(v.id)}
                csrf={csrf}
                variant={v}
              />
            </div>
          ))}
          <h3>Добавить вариант</h3>
          <SellerForm
            path={path + '/variants'}
            csrf={csrf}
            fields={[
              { name: 'size', label: 'Размер', required: true, maxLength: 40 },
              { name: 'color', label: 'Цвет', required: true, maxLength: 40 },
            ]}
          />
          <ImageManager
            path={path}
            csrf={csrf}
            images={images.map((image) => ({
              id: string(image.id),
              alt: string(image.alt),
              position: Number(image.position),
            }))}
          />
        </>
      );
    }
  } else if (section === 'products') {
    content = (
      <SellerProducts shopId={shopId} csrf={csrf} query={await searchParams} />
    );
  } else {
    const q = await searchParams;
    const page =
      typeof q.page === 'string' && /^[1-9][0-9]{0,2}$/.test(q.page)
        ? Number(q.page)
        : 1;
    const list = array(
      await sellerRead(base + '/products?limit=20&page=' + page),
    ).map(record);
    content = (
      <>
        <p>
          Статус магазина: <Badge>{string(shop.status)}</Badge>
        </p>
        <Link className="button button-primary" href={href + '/products/new'}>
          Добавить товар
        </Link>
        <div className="seller-list">
          {list.map((p) => (
            <Link key={string(p.id)} href={href + '/products/' + string(p.id)}>
              <h3>{string(p.name)}</h3>
              <span>
                {Number(p.basePrice).toLocaleString('ru-RU')} ₸ ·{' '}
                {string(p.status)}
              </span>
            </Link>
          ))}
        </div>
        {!list.length && (
          <EmptyState
            title="Товаров пока нет"
            description="Добавьте первый товар. Он будет создан как черновик."
          />
        )}
        <nav aria-label="Страницы товаров" className="seller-row">
          {page > 1 && (
            <Link href={href + '/' + section + '?page=' + (page - 1)}>
              Назад
            </Link>
          )}
          <span>Страница {page}</span>
          {list.length === 20 && (
            <Link href={href + '/' + section + '?page=' + (page + 1)}>
              Далее
            </Link>
          )}
        </nav>
      </>
    );
  }
  return (
    <>
      <Link href="/seller">← Все магазины</Link>
      <div className="seller-shell">
        <aside>
          <p className="eyebrow">QRG BUSINESS</p>
          <h2>{string(shop.name)}</h2>
          <nav aria-label="Кабинет продавца">
            {sections.map(([key, label]) => (
              <Link
                key={key}
                aria-current={section === key ? 'page' : undefined}
                href={href + (key ? '/' + key : '')}
              >
                {label}
              </Link>
            ))}
          </nav>
        </aside>
        <section>
          <h1>
            {detail === 'new'
              ? 'Новый товар'
              : detail
                ? section === 'requests'
                  ? 'Заявка покупателя'
                  : 'Редактирование товара'
                : sections.find(([key]) => key === section)?.[1]}
          </h1>
          {content}
        </section>
      </div>
    </>
  );
}
