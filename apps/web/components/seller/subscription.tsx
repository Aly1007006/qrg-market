import Link from 'next/link';
import { sellerRead } from '../../lib/seller/server';
import { array, record, string } from '../../lib/catalogue/contract';
import { SellerForm } from './forms';
const labels: Record<string, string> = {
  ACTIVE: 'Активна',
  PAST_DUE: 'Платёж не прошёл',
  GRACE: 'Льготный период',
  SUSPENDED: 'Приостановлена',
  CANCELLED: 'Отменена',
};
const date = (value: unknown) =>
  value
    ? new Date(string(value)).toLocaleString('ru-RU', {
        timeZone: 'Asia/Almaty',
      })
    : '—';
export async function SellerSubscription({
  shopId,
  csrf,
  role,
  query,
}: {
  shopId: string;
  csrf: string;
  role: string;
  query: Record<string, string | string[] | undefined>;
}) {
  if (role !== 'SHOP_OWNER')
    return <p>Подпиской управляет владелец магазина.</p>;
  const page =
    typeof query.page === 'string' && /^[1-9][0-9]{0,2}$/.test(query.page)
      ? Number(query.page)
      : 1;
  const path = 'shops/' + shopId + '/subscription';
  const data = record(await sellerRead(path + '?page=' + page));
  const s = data.subscription ? record(data.subscription) : null;
  const attempts = array(data.attempts).map(record);
  return (
    <section aria-label="Подписка магазина">
      <h2>QRG BUSINESS · 10 000 ₸ / месяц</h2>
      <p>{s ? labels[string(s.status)] : 'Подписка ещё не оформлена'}</p>
      <p>
        Оплата доступа к QRG — не оплата товаров покупателей. Пробный период
        выключен.
      </p>
      {!s && (
        <SellerForm
          path={path}
          csrf={csrf}
          label="Создать подписку без оплаты"
        />
      )}
      {s && (
        <>
          <dl className="specs">
            <div>
              <dt>Оплаченный период</dt>
              <dd>
                {date(s.periodStart)} — {date(s.periodEnd)}
              </dd>
            </div>
            <div>
              <dt>Следующий платёж</dt>
              <dd>{date(s.nextPaymentAt)}</dd>
            </div>
            <div>
              <dt>Льготный период до</dt>
              <dd>{date(s.graceEndsAt)}</dd>
            </div>
            <div>
              <dt>Автопродление</dt>
              <dd>{s.autoRenew ? 'Включено' : 'Выключено'}</dd>
            </div>
            <div>
              <dt>Отмена в конце периода</dt>
              <dd>
                {s.cancelAtPeriodEnd ? 'Запланирована' : 'Не запланирована'}
              </dd>
            </div>
          </dl>
          {s.autoRenew === true && (
            <SellerForm
              path={path + '/disable-auto-renew'}
              csrf={csrf}
              numeric={['expectedVersion']}
              fields={[
                {
                  name: 'expectedVersion',
                  type: 'hidden',
                  label: '',
                  value: Number(s.version),
                },
              ]}
              label="Отключить автопродление"
            />
          )}
          {!s.cancelAtPeriodEnd && s.status !== 'CANCELLED' && (
            <SellerForm
              path={path + '/cancel'}
              csrf={csrf}
              numeric={['expectedVersion']}
              fields={[
                {
                  name: 'expectedVersion',
                  type: 'hidden',
                  label: '',
                  value: Number(s.version),
                },
              ]}
              label="Отменить подписку в конце оплаченного периода"
            />
          )}
        </>
      )}
      <button
        className="button"
        disabled
        aria-describedby="billing-unavailable"
      >
        Продлить подписку
      </button>
      <p id="billing-unavailable">
        Онлайн-оплата пока не подключена. Кнопка станет доступна после
        подключения платёжного провайдера. Кабинет, товары и фотографии
        сохраняются при приостановке.
      </p>
      <h2>История попыток оплаты</h2>
      {!attempts.length && <p>Попыток оплаты пока нет.</p>}
      <div className="seller-list">
        {attempts.map((a) => (
          <article key={string(a.id)}>
            <p>
              {date(a.createdAt)} ·{' '}
              {a.status === 'SUCCEEDED'
                ? 'Успешно'
                : a.status === 'FAILED'
                  ? 'Неуспешно'
                  : 'Ожидает подтверждения'}
            </p>
            <p>{Number(a.amountMinor) / 100} KZT</p>
          </article>
        ))}
      </div>
      <nav aria-label="Страницы истории оплаты">
        {page > 1 && <Link href={'?page=' + (page - 1)}>Назад</Link>}{' '}
        {attempts.length === 20 && (
          <Link href={'?page=' + (page + 1)}>Далее</Link>
        )}
      </nav>
    </section>
  );
}
