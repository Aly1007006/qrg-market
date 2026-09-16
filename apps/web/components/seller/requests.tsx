import Link from 'next/link';
import { sellerRead } from '../../lib/seller/server';
import { array, record, string } from '../../lib/catalogue/contract';
import { requestStatuses } from '../../lib/customer-requests';
import { Badge, EmptyState } from '../ui';
import { SellerForm } from './forms';
const statusLabel = (status: string) =>
  requestStatuses.find((s) => s.value === status)?.label ?? status;
export async function SellerRequests({
  shopId,
  detail,
  csrf,
  query,
}: {
  shopId: string;
  detail?: string;
  csrf: string;
  query: Record<string, string | string[] | undefined>;
}) {
  const base = 'shops/' + shopId + '/requests';
  const href = '/seller/' + shopId + '/requests';
  if (detail) {
    const r = record(await sellerRead(base + '/' + detail));
    const status = string(r.status);
    return (
      <>
        <Link href={href}>← Все заявки</Link>
        <h2>{string(r.productName)}</h2>
        <Badge>{statusLabel(status)}</Badge>
        <dl className="specs">
          <div>
            <dt>Имя</dt>
            <dd>{string(r.name)}</dd>
          </div>
          <div>
            <dt>Телефон</dt>
            <dd>
              <a href={'tel:' + string(r.phone)}>{string(r.phone)}</a>
            </dd>
          </div>
          <div>
            <dt>Вариант</dt>
            <dd>{string(r.variantLabel) || 'Уточнить у покупателя'}</dd>
          </div>
          <div>
            <dt>Количество</dt>
            <dd>{Number(r.quantity)}</dd>
          </div>
          <div>
            <dt>Получение</dt>
            <dd>
              {r.pickupPreference === 'SHOP_PICKUP'
                ? 'В магазине'
                : 'Обсудить с покупателем'}
            </dd>
          </div>
          <div>
            <dt>Дата</dt>
            <dd>{new Date(string(r.createdAt)).toLocaleString('ru-RU')}</dd>
          </div>
        </dl>
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {r.comment == null ? 'Без комментария' : string(r.comment)}
        </p>
        <p className="payment-note">
          «Обращение подтверждено» означает подтверждение заявки продавцом, а не
          факт оплаты. QRG не принимает оплату покупателя.
        </p>
        <SellerForm
          key={status}
          path={base + '/' + detail}
          method="PATCH"
          csrf={csrf}
          fields={[
            {
              name: 'status',
              label: 'Статус обращения',
              value: status,
              options: requestStatuses.filter(
                (s) => s.value !== 'NEW' || status === 'NEW',
              ),
            },
            {
              name: 'expectedStatus',
              label: 'Текущий статус',
              type: 'hidden',
              value: status,
            },
          ]}
          label="Изменить статус"
        />
      </>
    );
  }
  const page =
    typeof query.page === 'string' && /^[1-9][0-9]{0,2}$/.test(query.page)
      ? Number(query.page)
      : 1;
  const status =
    typeof query.status === 'string' &&
    requestStatuses.some((s) => s.value === query.status)
      ? query.status
      : '';
  const params = new URLSearchParams({
    page: String(page),
    limit: '20',
    ...(status ? { status } : {}),
  });
  const data = record(await sellerRead(base + '?' + params));
  const items = array(data.items).map(record);
  const total = Number(data.total);
  const pageUrl = (p: number) =>
    href +
    '?' +
    new URLSearchParams({ page: String(p), ...(status ? { status } : {}) });
  return (
    <>
      <p>Обращения покупателей к вашему магазину. Это не платёжные заказы.</p>
      <form method="get" className="seller-row">
        <label className="field">
          Статус
          <select name="status" defaultValue={status}>
            <option value="">Все</option>
            {requestStatuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button className="button button-secondary">Показать</button>
      </form>
      <p>Заявок: {total}</p>
      <div className="seller-list">
        {items.map((r) => (
          <Link key={string(r.id)} href={href + '/' + string(r.id)}>
            <h3>{string(r.productName)}</h3>
            <p>
              {string(r.name)} · {Number(r.quantity)} шт.
            </p>
            <Badge>{statusLabel(string(r.status))}</Badge>
          </Link>
        ))}
      </div>
      {!items.length && (
        <EmptyState
          title="Заявок пока нет"
          description="Покупатели смогут отправить обращение со страницы опубликованного товара активного магазина."
        />
      )}
      <nav className="seller-row" aria-label="Страницы заявок">
        {page > 1 && <Link href={pageUrl(page - 1)}>Назад</Link>}
        <span>Страница {page}</span>
        {page * 20 < total && <Link href={pageUrl(page + 1)}>Далее</Link>}
      </nav>
    </>
  );
}
