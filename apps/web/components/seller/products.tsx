import Link from 'next/link';
import { sellerRead } from '../../lib/seller/server';
import { array, record, string } from '../../lib/catalogue/contract';
import { Input, Select, Button } from '../ui';
import { ProductList, type SellerProductRow } from './product-list';
export async function SellerProducts({
  shopId,
  csrf,
  query,
}: {
  shopId: string;
  csrf: string;
  query: Record<string, string | string[] | undefined>;
}) {
  const parameters = new URLSearchParams({ limit: '20' });
  for (const key of ['q', 'category', 'status', 'stock', 'sort', 'page']) {
    const value = query[key];
    if (typeof value === 'string' && value.length <= 120)
      parameters.set(key, value);
  }
  const rows = array(
    await sellerRead('shops/' + shopId + '/products?' + parameters),
  ).map(record);
  const categories = array(await sellerRead('public/categories')).map(record);
  const drafts = array(await sellerRead('shops/' + shopId + '/product-drafts'))
    .map(record)
    .filter((draft) => !draft.productId);
  const page = Number(parameters.get('page') ?? 1);
  const total = Number(rows[0]?.total ?? 0);
  const href = '/seller/' + shopId + '/products';
  const pageLink = (n: number) => {
    const params = new URLSearchParams(parameters);
    params.set('page', String(n));
    return href + '?' + params;
  };
  return (
    <>
      <Link className="button button-primary" href={href + '/new'}>
        Добавить товар
      </Link>
      {drafts.length > 0 && (
        <details>
          <summary>
            Продолжить незавершённое добавление ({drafts.length})
          </summary>
          <ul>
            {drafts.map((draft) => (
              <li key={string(draft.id)}>
                <Link href={href + '/new?draft=' + string(draft.id)}>
                  {typeof record(draft.content).name === 'string'
                    ? string(record(draft.content).name)
                    : 'Новый товар'}{' '}
                  ·{' '}
                  {new Date(string(draft.updatedAt)).toLocaleDateString(
                    'ru-RU',
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
      <form action={href} className="operations-filters">
        <Input
          id="product-search"
          name="q"
          label="Поиск по товарам"
          defaultValue={parameters.get('q') ?? ''}
          maxLength={100}
        />
        <Select
          id="product-category"
          name="category"
          label="Категория"
          defaultValue={parameters.get('category') ?? ''}
        >
          <option value="">Все категории</option>
          {categories.map((c) => (
            <option key={string(c.id)} value={string(c.slug)}>
              {string(c.name)}
            </option>
          ))}
        </Select>
        <Select
          id="product-status"
          name="status"
          label="Статус"
          defaultValue={parameters.get('status') ?? ''}
        >
          <option value="">Все статусы</option>
          <option value="DRAFT">Черновик / скрыт</option>
          <option value="PUBLISHED">Опубликован</option>
          <option value="ARCHIVED">В архиве</option>
        </Select>
        <Select
          id="product-stock"
          name="stock"
          label="Наличие"
          defaultValue={parameters.get('stock') ?? ''}
        >
          <option value="">Любое</option>
          <option value="available">В наличии</option>
          <option value="unavailable">Нет в наличии</option>
        </Select>
        <Select
          id="product-sort"
          name="sort"
          label="Порядок"
          defaultValue={parameters.get('sort') ?? ''}
        >
          <option value="">Недавно изменённые</option>
          <option value="price-asc">Сначала дешевле</option>
          <option value="price-desc">Сначала дороже</option>
        </Select>
        <Button>Показать</Button>
      </form>
      <ProductList
        shopId={shopId}
        csrf={csrf}
        rows={rows.map(
          (row) =>
            ({
              id: string(row.id),
              name: string(row.name),
              basePrice: Number(row.basePrice),
              categoryName: string(row.categoryName),
              available: row.available === true,
              status: string(row.status),
              views: Number(row.views),
              updatedAt: string(row.updatedAt),
              imageId: typeof row.imageId === 'string' ? row.imageId : null,
            }) satisfies SellerProductRow,
        )}
      />
      <nav className="seller-row" aria-label="Страницы товаров">
        {page > 1 && <Link href={pageLink(page - 1)}>Назад</Link>}
        <span>
          Страница {page} · Товаров: {total}
        </span>
        {page * 20 < total && <Link href={pageLink(page + 1)}>Далее</Link>}
      </nav>
    </>
  );
}
