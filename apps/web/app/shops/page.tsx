import Link from 'next/link';
import { readShopDirectory } from '../../lib/catalogue/repository';
import type { SearchValues } from '../../lib/catalogue/model';
import { pageMetadata } from '../../lib/seo';
import { ShopCard } from '../../components/cards';
import { ButtonLink, EmptyState } from '../../components/ui';
import styles from '../../components/market.module.css';
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchValues>;
}) {
  const metadata = pageMetadata(
    'Бутики Караганды',
    'Магазины вашего города: адреса, контакты и товары в одном месте.',
    '/shops',
  );
  if ((await searchParams).page)
    metadata.robots = { index: false, follow: true };
  return metadata;
}
export default async function ShopsPage({
  searchParams,
}: {
  searchParams: Promise<SearchValues>;
}) {
  const query = await searchParams;
  const page =
    typeof query.page === 'string' && /^[1-9][0-9]{0,2}$/.test(query.page)
      ? Number(query.page)
      : 1;
  const { shops, more, mode } = await readShopDirectory(page);
  return (
    <main
      id="main-content"
      className={'container catalogue-page ' + styles.surface}
    >
      <nav className="breadcrumbs" aria-label="Хлебные крошки">
        <Link href="/">Главная</Link>
        <span aria-hidden="true">/</span>
        <span>Бутики</span>
      </nav>
      <div className="collection-intro">
        <p className="eyebrow">МАГАЗИНЫ ВАШЕГО ГОРОДА</p>
        <h1>Бутики Караганды</h1>
        <p>
          Познакомьтесь с магазинами, посмотрите товары и свяжитесь с продавцом
          напрямую.
        </p>
      </div>
      {shops.length ? (
        <div className={styles.shopGrid}>
          {shops.map((shop) => (
            <ShopCard key={shop.slug} shop={shop} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={
            mode === 'unavailable'
              ? 'Витрина готовится к открытию'
              : page > 1
                ? 'Вы посмотрели все бутики'
                : 'Здесь скоро появятся бутики города'
          }
          description="В публичную витрину попадают только проверенные магазины с активной подпиской."
          action={
            <ButtonLink
              href={page > 1 ? '/shops' : '/catalog'}
              variant="secondary"
            >
              {page > 1 ? 'К началу списка' : 'Открыть каталог'}
            </ButtonLink>
          }
        />
      )}
      {(page > 1 || more) && (
        <nav className="pagination" aria-label="Страницы бутиков">
          {page > 1 && (
            <ButtonLink href={'/shops?page=' + (page - 1)} variant="secondary">
              Назад
            </ButtonLink>
          )}
          <span>Страница {page}</span>
          {more && page < 999 && (
            <ButtonLink href={'/shops?page=' + (page + 1)} variant="secondary">
              Далее
            </ButtonLink>
          )}
        </nav>
      )}
    </main>
  );
}
