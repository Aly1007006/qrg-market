import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { adminRead } from '../../../lib/admin/server';
import { array, record, string } from '../../../lib/catalogue/contract';
import { uuidPattern } from '../../../lib/seller/boundary';
import {
  shopStatuses,
  shopStatusLabel,
  moderationActions,
} from '../../../lib/moderation';
import {
  AdminDecisionForm,
  AdminSessionAction,
} from '../../../components/admin/forms';
import { Badge, EmptyState, Input } from '../../../components/ui';
import { AdminSecurity } from '../../../components/admin/security';
import { ControlCenter } from '../../../components/admin/control-center';
const date = (value: unknown) =>
  new Date(string(value)).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' });
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ segments?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const segments = (await params).segments ?? [];
  const section = segments[0] ?? '';
  const id = segments[1];
  if (
    segments.length > 2 ||
    ![
      '',
      'shops',
      'audit',
      'settings',
      'users',
      'products',
      'subscriptions',
      'administrators',
    ].includes(section) ||
    (id &&
      (!['shops', 'users', 'products'].includes(section) ||
        !new RegExp(`^${uuidPattern}$`).test(id)))
  )
    notFound();
  const me = record(await adminRead('auth/me'));
  const permissions = array(me.permissions).map(string);
  const csrf = string(me.csrfToken);
  if (
    me.mustChangePassword === true ||
    me.mfaEnrolled === false ||
    section === 'settings'
  )
    return (
      <AdminSecurity
        csrf={csrf}
        mustChangePassword={me.mustChangePassword === true}
        mfaEnrolled={me.mfaEnrolled === true}
      />
    );
  const query = await searchParams;
  const page =
    typeof query.page === 'string' && /^[1-9][0-9]{0,2}$/.test(query.page)
      ? Number(query.page)
      : 1;
  let content: React.ReactNode;
  let title = 'Проверка магазинов';
  if (
    ['users', 'products', 'subscriptions', 'administrators'].includes(section)
  ) {
    title =
      (
        {
          users: 'Пользователи',
          products: 'Товары',
          subscriptions: 'Подписки',
          administrators: 'Администраторы',
        } as Record<string, string>
      )[section] ?? '';
    content = (
      <ControlCenter
        section={section}
        {...(id ? { id } : {})}
        csrf={csrf}
        permissions={permissions}
        query={query}
      />
    );
  } else if (!section && permissions.includes('overview.read')) {
    title = 'Обзор платформы';
    content = (
      <ControlCenter
        section="overview"
        csrf={csrf}
        permissions={permissions}
        query={query}
      />
    );
  } else if (!section && !permissions.includes('moderation.read')) {
    redirect(
      permissions.includes('subscriptions.read')
        ? '/admin/subscriptions'
        : '/admin/settings',
    );
  } else if (section === 'shops' && id) {
    const data = record(await adminRead('shops/' + id));
    const shop = record(data.shop);
    const location = data.location ? record(data.location) : {};
    const contacts = data.contacts ? record(data.contacts) : {};
    const entry = data.currentCase ? record(data.currentCase) : {};
    title = string(shop.name);
    content = (
      <>
        <Link href="/admin/shops?status=PENDING_VERIFICATION">
          ← Очередь проверки
        </Link>
        <p>
          <Badge>{shopStatusLabel(string(shop.status))}</Badge>
        </p>
        <dl className="specs">
          <div>
            <dt>ID магазина</dt>
            <dd>{id}</dd>
          </div>
          <div>
            <dt>Адрес</dt>
            <dd>{string(location.address ?? '') || 'Не указан'}</dd>
          </div>
          <div>
            <dt>Телефон</dt>
            <dd>{string(contacts.phone ?? '') || 'Не указан'}</dd>
          </div>
          <div>
            <dt>WhatsApp</dt>
            <dd>{string(contacts.whatsappPhone ?? '') || 'Не указан'}</dd>
          </div>
          <div>
            <dt>Карточка 2GIS</dt>
            <dd>{string(location.twoGisUrl ?? '') || 'Не указана'}</dd>
          </div>
        </dl>
        <p>{string(shop.description ?? '')}</p>
        <h2>Владелец и сотрудники</h2>
        {array(data.members)
          .map(record)
          .map((member) => (
            <p key={string(member.id)}>
              {permissions.includes('users.read') ? (
                <Link href={'/admin/users/' + string(member.userId)}>
                  {string(member.email)}
                </Link>
              ) : (
                string(member.email)
              )}{' '}
              · {string(member.role)}
            </p>
          ))}
        <h2>Подписка</h2>
        {data.subscription ? (
          <p>
            {string(record(data.subscription).status)} ·{' '}
            {record(data.subscription).periodEnd
              ? 'До ' + date(record(data.subscription).periodEnd)
              : 'Период не начат'}
          </p>
        ) : (
          <p>Подписка ещё не оформлена.</p>
        )}
        {permissions.includes('products.read') && (
          <>
            <h2>Товары</h2>
            {array(data.products)
              .map(record)
              .map((product) => (
                <p key={string(product.id)}>
                  <Link href={'/admin/products/' + string(product.id)}>
                    {string(product.name)}
                  </Link>{' '}
                  · {string(product.status)}
                </p>
              ))}
            <Link
              href={
                '/admin/products?q=' + encodeURIComponent(string(shop.name))
              }
            >
              Все товары магазина
            </Link>
          </>
        )}
        {permissions.includes('audit.read') && (
          <Link href={'/admin/audit?resourceId=' + id}>Аудит магазина</Link>
        )}
        <p>
          Одобрение проверки не публикует магазин: для ACTIVE должны быть
          выполнены остальные условия, включая подписку.
        </p>
        <AdminDecisionForm
          key={string(shop.status) + string(entry.id ?? '')}
          shopId={id}
          status={string(shop.status)}
          caseId={typeof entry.id === 'string' ? entry.id : null}
          actions={moderationActions(string(shop.status), permissions)}
          csrf={csrf}
        />
        <h2>История модерации</h2>
        <p className="muted">Последние 50 событий.</p>
        <div className="seller-list">
          {array(data.history)
            .map(record)
            .map((h) => (
              <article key={string(h.id)}>
                <p>
                  {date(h.createdAt)} · {string(h.action)}
                </p>
                <p>
                  {shopStatusLabel(string(h.fromStatus))} →{' '}
                  {shopStatusLabel(string(h.toStatus))}
                </p>
                <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {string(h.reason ?? '') || 'Без комментария'}
                </p>
                <p className="muted">Участник: {string(h.actorId)}</p>
              </article>
            ))}
        </div>
      </>
    );
  } else if (section === 'shops') {
    title = 'Магазины';
    const search = typeof query.q === 'string' ? query.q.slice(0, 100) : '';
    const status =
      typeof query.status === 'string' &&
      shopStatuses.some((s) => s.value === query.status)
        ? query.status
        : '';
    const data = record(
      await adminRead(
        'shops?' +
          new URLSearchParams({
            page: String(page),
            q: search,
            ...(status ? { status } : {}),
          }),
      ),
    );
    const items = array(data.items).map(record);
    const href = (n: number) =>
      '/admin/shops?' +
      new URLSearchParams({
        page: String(n),
        q: search,
        ...(status ? { status } : {}),
      });
    content = (
      <>
        <form className="seller-row">
          <Input
            id="admin-shop-search"
            name="q"
            label="Название бутика или email владельца"
            defaultValue={search}
            maxLength={100}
          />
          <label className="field">
            Статус
            <select name="status" defaultValue={status}>
              <option value="">Все магазины</option>
              {shopStatuses.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button className="button button-secondary">Показать</button>
        </form>
        <p>Найдено: {Number(data.total)}</p>
        <div className="seller-list">
          {items.map((s) => (
            <Link key={string(s.id)} href={'/admin/shops/' + string(s.id)}>
              <h2>{string(s.name)}</h2>
              <Badge>{shopStatusLabel(string(s.status))}</Badge>
              <p>
                {string(s.ownerEmail ?? 'Владелец не указан')} · Товаров:{' '}
                {Number(s.productCount)} ·{' '}
                {s.publicVisible ? 'Публичный' : 'Скрыт от покупателей'}
              </p>
              <p>
                Подписка: {string(s.subscriptionStatus ?? 'Не оформлена')} ·
                Создан {date(s.createdAt)}
              </p>
            </Link>
          ))}
        </div>
        {!items.length && (
          <EmptyState
            title="Магазинов с этим статусом нет"
            description="Новые обращения появятся после отправки продавцом на проверку."
          />
        )}
        <nav className="seller-row" aria-label="Страницы магазинов">
          {page > 1 && <Link href={href(page - 1)}>Назад</Link>}
          <span>Страница {page}</span>
          {page * 20 < Number(data.total) && (
            <Link href={href(page + 1)}>Далее</Link>
          )}
        </nav>
      </>
    );
  } else if (section === 'audit') {
    title = 'Журнал аудита';
    const resourceId =
      typeof query.resourceId === 'string' &&
      new RegExp(`^${uuidPattern}$`).test(query.resourceId)
        ? query.resourceId
        : '';
    const auditHref = (n: number) =>
      '/admin/audit?' +
      new URLSearchParams({
        page: String(n),
        ...(resourceId ? { resourceId } : {}),
      });
    const rows = array(
      await adminRead(
        'audit?' +
          new URLSearchParams({
            page: String(page),
            ...(resourceId ? { resourceId } : {}),
          }),
      ),
    ).map(record);
    content = (
      <>
        <p>Записи доступны только для чтения. Время — Караганда.</p>
        <div className="seller-list">
          {rows.map((r) => (
            <article key={string(r.id)}>
              <h2>
                {string(r.action)} · {string(r.result)}
              </h2>
              <p>{date(r.createdAt)}</p>
              <p>Участник: {string(r.actor)}</p>
              {typeof r.reason === 'string' && <p>Причина: {r.reason}</p>}
              {typeof r.requestId === 'string' && <p>Запрос: {r.requestId}</p>}
              <p>
                Ресурс: {string(r.resource)} {string(r.resourceId ?? '')}
              </p>
            </article>
          ))}
        </div>
        <nav className="seller-row" aria-label="Страницы аудита">
          {page > 1 && <Link href={auditHref(page - 1)}>Назад</Link>}
          <span>Страница {page}</span>
          {rows.length === 20 && <Link href={auditHref(page + 1)}>Далее</Link>}
        </nav>
      </>
    );
  } else {
    const counts = array(await adminRead('dashboard')).map(record);
    content = (
      <>
        <Link
          className="button"
          href="/admin/shops?status=PENDING_VERIFICATION"
        >
          Открыть очередь проверки
        </Link>
        <div className="seller-list">
          {shopStatuses.map((s) => (
            <Link key={s.value} href={'/admin/shops?status=' + s.value}>
              <h2>{s.label}</h2>
              <p>
                {Number(counts.find((c) => c.status === s.value)?.count ?? 0)}
              </p>
            </Link>
          ))}
        </div>
      </>
    );
  }
  return (
    <>
      <h1>{title}</h1>
      <div className="seller-row">
        <Link href="/admin">Обзор</Link>
        {permissions.includes('moderation.read') && (
          <Link href="/admin/shops">Бутики</Link>
        )}
        {permissions.includes('users.read') && (
          <Link href="/admin/users">Пользователи</Link>
        )}
        {permissions.includes('products.read') && (
          <Link href="/admin/products">Товары</Link>
        )}
        {permissions.includes('subscriptions.read') && (
          <Link href="/admin/subscriptions">Подписки</Link>
        )}
        {permissions.includes('admins.write') && (
          <Link href="/admin/administrators">Администраторы</Link>
        )}
        <Link href="/admin/settings">Настройки</Link>
        {permissions.includes('moderation.read') && (
          <Link href="/admin/shops?status=PENDING_VERIFICATION">
            Ожидают проверки
          </Link>
        )}
        {permissions.includes('audit.read') && (
          <Link href="/admin/audit">Аудит</Link>
        )}
      </div>
      <p className="muted">
        Сессия до {date(me.expiresAt)} (Караганда). Бездействие более 15 минут
        завершает доступ.
      </p>
      {content}
      <div className="seller-row">
        <AdminSessionAction csrf={csrf} action="rotate" />
        <AdminSessionAction csrf={csrf} action="logout" />
      </div>
    </>
  );
}
