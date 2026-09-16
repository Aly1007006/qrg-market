import Link from 'next/link';
import { sellerRead } from '../../lib/seller/server';
import { array, record, string, number } from '../../lib/catalogue/contract';
import { EmptyState, Select } from '../ui';
export async function SellerAnalytics({
  shopId,
  role,
  query,
}: {
  shopId: string;
  role: string;
  query: Record<string, string | string[] | undefined>;
}) {
  if (!['SHOP_OWNER', 'SHOP_MANAGER'].includes(role))
    return (
      <EmptyState
        title="Статистика доступна владельцу и менеджеру"
        description="Обратитесь к владельцу магазина для изменения доступа."
      />
    );
  const days =
    typeof query.days === 'string' && ['7', '30', '90'].includes(query.days)
      ? query.days
      : '7';
  const data = record(
    await sellerRead(`shops/${shopId}/analytics?days=${days}`),
  );
  const totals = record(data.totals);
  const popular = array(data.popularProducts).map(record);
  return (
    <section aria-labelledby="analytics-title">
      <h2 id="analytics-title">Статистика магазина</h2>
      <form method="get" className="sort-form">
        <Select
          id="analytics-period"
          label="Период"
          name="days"
          defaultValue={days}
        >
          {[7, 30, 90].map((value) => (
            <option key={value} value={value}>
              {value} дней
            </option>
          ))}
        </Select>
        <button className="button button-secondary" type="submit">
          Показать
        </button>
      </form>
      <p>
        Последние {days} × 24 часа. Данные на{' '}
        {new Date(string(data.to)).toLocaleString('ru-RU', {
          timeZone: 'Asia/Almaty',
        })}{' '}
        (Караганда).
      </p>
      <dl className="analytics-metrics">
        {[
          ['SHOP_VIEW', 'Просмотры магазина'],
          ['PRODUCT_VIEW', 'Просмотры товаров'],
          ['WHATSAPP_CLICK', 'Переходы в WhatsApp'],
          ['TWO_GIS_CLICK', 'Переходы в 2GIS'],
          ['CUSTOMER_REQUEST_CREATED', 'Заявки покупателей'],
        ].map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{number(totals[key!]).toLocaleString('ru-RU')}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">
        Просмотры и клики — события, не уникальные посетители и не продажи.
        Блокировщики и настройки приватности могут снижать показатели. Заявки
        учитываются сервером после успешного создания; данные до подключения
        аналитики не восстанавливаются.
      </p>
      <h3>Популярные товары по просмотрам</h3>
      {popular.length ? (
        <ol className="seller-list">
          {popular.map((p) => (
            <li key={string(p.id)}>
              <Link href={`/seller/${shopId}/products/${string(p.id)}`}>
                {string(p.name)}
              </Link>
              <span>
                {' '}
                — просмотры: {number(p.views).toLocaleString('ru-RU')}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          title="Просмотров за этот период пока нет"
          description="Здесь появятся десять самых просматриваемых товаров вашего магазина."
        />
      )}
    </section>
  );
}
