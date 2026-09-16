import Link from 'next/link';
import { queryCatalogue } from '../../lib/catalogue/repository';
import {
  catalogueUrl,
  parseFilters,
  filterProducts,
  categories,
  type SearchValues,
} from '../../lib/catalogue/model';
import { pageMetadata } from '../../lib/seo';
import { ProductCard } from '../../components/cards';
import { FilterUI, SortUI } from '../../components/filters';
import { MobileDrawer } from '../../components/mobile-drawer';
import { Search } from '../../components/shell';
import { EmptyState, ButtonLink } from '../../components/ui';
import styles from '../../components/market.module.css';
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchValues>;
}) {
  const metadata = pageMetadata(
    'Каталог товаров Караганды',
    'Находите одежду, обувь, аксессуары и парфюмерию в магазинах Караганды.',
    '/catalog',
  );
  if (Object.keys(await searchParams).length)
    metadata.robots = { index: false, follow: true };
  return metadata;
}
export default async function Catalog({
  searchParams,
}: {
  searchParams: Promise<SearchValues>;
}) {
  const filters = parseFilters(await searchParams);
  const data = await queryCatalogue(filters);
  const result = data.result ?? filterProducts(data, filters);
  return (
    <main
      id="main-content"
      className={'container catalogue-page ' + styles.surface}
    >
      <nav className="breadcrumbs" aria-label="Хлебные крошки">
        <Link href="/">Главная</Link>
        <span aria-hidden="true">/</span>
        <span>Каталог</span>
      </nav>
      <div className="catalogue-intro">
        <div>
          <p className="eyebrow">НАХОДКИ В ВАШЕМ ГОРОДЕ</p>
          <h1>Каталог</h1>
        </div>
        <Search value={filters.q} id="catalog-search" />
      </div>
      <nav className="category-pills" aria-label="Категории каталога">
        <Link
          href={catalogueUrl(filters, {
            category: '',
            subcategory: '',
            page: 1,
          })}
          aria-current={!filters.category ? 'page' : undefined}
        >
          Все категории
        </Link>
        {(data.categories ?? categories).map((c) => (
          <Link
            key={c.slug}
            href={catalogueUrl(filters, {
              category: c.slug,
              subcategory: '',
              page: 1,
            })}
            aria-current={filters.category === c.slug ? 'page' : undefined}
          >
            {c.name}
          </Link>
        ))}
      </nav>
      <div className="catalogue-layout">
        <aside className="desktop-filters" aria-label="Фильтры">
          <h2>Фильтры</h2>
          <FilterUI data={data} filters={filters} id="desktop" />
        </aside>
        <section className="catalogue-results" aria-label="Результаты поиска">
          <div className="catalogue-toolbar">
            <p aria-live="polite">
              {data.mode === 'fixtures'
                ? 'Демо-товаров найдено: ' + result.total
                : data.mode === 'live'
                  ? 'Товаров найдено: ' + result.total
                  : 'Предложения пока не подключены'}
            </p>
            <MobileDrawer
              title="Фильтры"
              trigger="Фильтры"
              className="mobile-filters"
            >
              <FilterUI data={data} filters={filters} id="mobile" />
            </MobileDrawer>
            <SortUI filters={filters} />
          </div>
          {filters.q && <p className="search-summary">Поиск: «{filters.q}»</p>}
          {result.items.length ? (
            <div className="product-grid">
              {result.items.map((p) => (
                <ProductCard
                  key={p.slug}
                  product={p}
                  shop={data.shops.find((s) => s.slug === p.shop)}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title={
                data.mode !== 'unavailable'
                  ? 'Ничего не нашлось'
                  : 'Каталог готовится к открытию'
              }
              description={
                data.mode !== 'unavailable'
                  ? 'Попробуйте другой запрос или измените фильтры.'
                  : 'Проверенные магазины и реальные товары появятся после подключения API.'
              }
              action={
                <ButtonLink href="/catalog" variant="secondary">
                  Сбросить фильтры
                </ButtonLink>
              }
            />
          )}
          <nav className="pagination" aria-label="Страницы каталога">
            {filters.page > 1 && (
              <ButtonLink
                variant="secondary"
                href={catalogueUrl(filters, { page: filters.page - 1 })}
              >
                Назад
              </ButtonLink>
            )}
            {result.pages > 1 && (
              <span>
                Страница {filters.page} из {result.pages}
              </span>
            )}
            {filters.page < result.pages && (
              <ButtonLink
                variant="secondary"
                href={catalogueUrl(filters, { page: filters.page + 1 })}
              >
                Далее
              </ButtonLink>
            )}
          </nav>
        </section>
      </div>
    </main>
  );
}
