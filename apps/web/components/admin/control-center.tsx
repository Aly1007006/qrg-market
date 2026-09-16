import Link from 'next/link';
import { adminRead } from '../../lib/admin/server';
import { array, record, string } from '../../lib/catalogue/contract';
import { Button, Input } from '../ui';
import { AdminActionForm } from './action-form';
const roles = [
  'SUPER_ADMIN',
  'MODERATION_ADMIN',
  'SUPPORT_ADMIN',
  'FINANCE_ADMIN',
].map((role) => ({ value: role, label: role }));
const date = (value: unknown) =>
  typeof value === 'string' ? new Date(value).toLocaleDateString('ru-RU') : '—';
const text = (value: unknown) => (typeof value === 'string' ? value : '—');
export async function ControlCenter({
  section,
  id,
  csrf,
  permissions,
  query,
}: {
  section: string;
  id?: string;
  csrf: string;
  permissions: string[];
  query: Record<string, string | string[] | undefined>;
}) {
  const page =
    typeof query.page === 'string' && /^[1-9][0-9]{0,2}$/.test(query.page)
      ? Number(query.page)
      : 1;
  const q = typeof query.q === 'string' ? query.q.slice(0, 100) : '';
  if (section === 'users' && id) {
    const data = record(await adminRead('users/' + id));
    const user = record(data.user);
    const memberships = array(data.memberships).map(record);
    return (
      <>
        <h2>{string(user.email)}</h2>
        <p>
          {user.disabledAt ? 'Аккаунт заблокирован' : 'Аккаунт активен'} ·
          Зарегистрирован {date(user.createdAt)}
        </p>
        <h3>Магазины и роли</h3>
        {memberships.map((member) => (
          <article key={string(member.id)}>
            <Link href={'/admin/shops/' + string(member.shopId)}>
              {string(member.shopName)}
            </Link>
            <p>{string(member.role)}</p>
            {permissions.includes('users.write') && (
              <AdminActionForm
                path={'users/' + id + '/actions'}
                csrf={csrf}
                label="Изменить роль в магазине"
                fixed={{ action: 'SHOP_ROLE', membershipId: string(member.id) }}
                fields={[
                  {
                    name: 'role',
                    label: 'Роль',
                    required: true,
                    options: [
                      'SHOP_OWNER',
                      'SHOP_MANAGER',
                      'SHOP_EMPLOYEE',
                    ].map((role) => ({ value: role, label: role })),
                  },
                ]}
              />
            )}
          </article>
        ))}
        <h3>Активные сессии</h3>
        {array(data.sessions)
          .map(record)
          .map((session) => (
            <p key={string(session.id)}>
              Вход {date(session.createdAt)} · до {date(session.expiresAt)}
            </p>
          ))}
        {permissions.includes('users.write') && (
          <>
            <AdminActionForm
              path={'users/' + id + '/actions'}
              csrf={csrf}
              label="Завершить все сессии"
              fixed={{ action: 'REVOKE_SESSIONS' }}
            />
            <AdminActionForm
              path={'users/' + id + '/actions'}
              csrf={csrf}
              label={
                user.disabledAt
                  ? 'Разблокировать аккаунт'
                  : 'Заблокировать аккаунт'
              }
              fixed={{ action: user.disabledAt ? 'ENABLE' : 'DISABLE' }}
            />
          </>
        )}
      </>
    );
  }
  if (section === 'products' && id) {
    const product = record(await adminRead('products/' + id));
    return (
      <>
        <h2>{string(product.name)}</h2>
        <Link href={'/admin/shops/' + string(product.shopId)}>
          {string(product.shopName)}
        </Link>
        <p>
          {Number(product.basePrice).toLocaleString('ru-RU')} ₸ ·{' '}
          {string(product.status)}
        </p>
        <p style={{ whiteSpace: 'pre-wrap' }}>{string(product.description)}</p>
        {permissions.includes('products.moderate') && (
          <AdminActionForm
            path={'products/' + id + '/moderation'}
            csrf={csrf}
            label={
              product.moderationHidden ? 'Восстановить товар' : 'Скрыть товар'
            }
            fixed={{ action: product.moderationHidden ? 'RESTORE' : 'HIDE' }}
          />
        )}
      </>
    );
  }
  if (section === 'overview') {
    const data = record(await adminRead('overview'));
    const labels: Record<string, string> = {
      shops: 'Всего бутиков',
      active_shops: 'Активные бутики',
      pending_shops: 'Ожидают проверки',
      suspended_shops: 'Приостановленные бутики',
      sellers: 'Продавцы',
      products: 'Товары',
      published_products: 'Опубликованные товары',
      active_subscriptions: 'Активные подписки',
      past_due: 'Просроченные подписки',
      grace: 'Льготный период',
      suspended_subscriptions: 'Приостановленные подписки',
    };
    return (
      <div className="analytics-metrics">
        {Object.entries(labels).map(([key, label]) => (
          <div key={key}>
            <h2>{label}</h2>
            <strong>{Number(data[key]).toLocaleString('ru-RU')}</strong>
          </div>
        ))}
      </div>
    );
  }
  const rows = array(
    await adminRead(
      section + '?' + new URLSearchParams({ page: String(page), q }),
    ),
  ).map(record);
  const href = '/admin/' + section;
  const total = Number(rows[0]?.total ?? 0);
  return (
    <>
      <form action={href} className="seller-row">
        <Input
          id="control-search"
          name="q"
          label="Поиск"
          defaultValue={q}
          maxLength={100}
        />
        <Button>Найти</Button>
      </form>
      <div className="seller-list">
        {rows.map((row) => (
          <article key={string(row.id)}>
            {section === 'users' && (
              <>
                <Link href={href + '/' + string(row.id)}>
                  <h2>{string(row.email)}</h2>
                </Link>
                <p>
                  {row.disabledAt ? 'Заблокирован' : 'Активен'} · Сессии:{' '}
                  {Number(row.activeSessions)} · {date(row.createdAt)}
                </p>
              </>
            )}
            {section === 'products' && (
              <>
                <Link href={href + '/' + string(row.id)}>
                  <h2>{string(row.name)}</h2>
                </Link>
                <p>
                  {string(row.shopName)} · {string(row.status)}{' '}
                  {row.moderationHidden ? '· Скрыт модератором' : ''}
                </p>
              </>
            )}
            {section === 'subscriptions' && (
              <>
                <h2>{string(row.shopName)}</h2>
                <p>
                  {string(row.plan)} · {string(row.status)}
                </p>
                <dl className="specs">
                  <div>
                    <dt>Создана</dt>
                    <dd>{date(row.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Текущий период</dt>
                    <dd>
                      {date(row.periodStart)} — {date(row.periodEnd)}
                    </dd>
                  </div>
                  <div>
                    <dt>Следующая оплата</dt>
                    <dd>{date(row.nextPaymentAt)}</dd>
                  </div>
                </dl>
                {row.lastPayment ? (
                  <p>
                    Последняя попытка: {text(record(row.lastPayment).status)} ·{' '}
                    {date(record(row.lastPayment).at)}
                  </p>
                ) : (
                  <p>Попыток оплаты пока нет.</p>
                )}
              </>
            )}
            {section === 'administrators' && (
              <>
                <h2>{string(row.email)}</h2>
                <p>
                  {string(row.role)} ·{' '}
                  {row.enabled ? 'Активен' : 'Деактивирован'} ·{' '}
                  {row.mfaEnrolled ? '2FA настроена' : 'Ожидает настройки 2FA'}
                </p>
                <AdminActionForm
                  path={'administrators/' + string(row.id) + '/actions'}
                  csrf={csrf}
                  label="Изменить роль администратора"
                  fixed={{ action: 'CHANGE_ROLE' }}
                  fields={[
                    {
                      name: 'role',
                      label: 'Платформенная роль',
                      required: true,
                      options: roles,
                    },
                  ]}
                />
                <AdminActionForm
                  path={'administrators/' + string(row.id) + '/actions'}
                  csrf={csrf}
                  label="Завершить сессии администратора"
                  fixed={{ action: 'REVOKE_SESSIONS' }}
                />
                {row.enabled === true && (
                  <AdminActionForm
                    path={'administrators/' + string(row.id) + '/actions'}
                    csrf={csrf}
                    label="Деактивировать администратора"
                    fixed={{ action: 'DEACTIVATE' }}
                  />
                )}
                <Link href={'/admin/audit?resourceId=' + string(row.id)}>
                  История действий
                </Link>
              </>
            )}
          </article>
        ))}
      </div>
      {!rows.length && <p>Ничего не найдено. Измените поиск.</p>}
      <nav aria-label="Страницы" className="seller-row">
        {page > 1 && (
          <Link
            href={
              href + '?' + new URLSearchParams({ page: String(page - 1), q })
            }
          >
            Назад
          </Link>
        )}
        <span>
          Страница {page} · Всего: {total}
        </span>
        {page * 20 < total && (
          <Link
            href={
              href + '?' + new URLSearchParams({ page: String(page + 1), q })
            }
          >
            Далее
          </Link>
        )}
      </nav>
      {section === 'administrators' && (
        <section>
          <h2>Новый администратор</h2>
          <AdminActionForm
            path="administrators"
            csrf={csrf}
            label="Создать администратора"
            fields={[
              { name: 'email', label: 'Email', type: 'email', required: true },
              {
                name: 'temporaryPassword',
                label: 'Временный пароль — не менее 12 символов',
                type: 'password',
                required: true,
              },
              { name: 'role', label: 'Роль', options: roles, required: true },
            ]}
          />
        </section>
      )}
    </>
  );
}
