import Link from 'next/link';
import type { Metadata } from 'next';
import { catalogueMode, readSavedItems } from '../../lib/catalogue/repository';
import {
  favoritesUrl,
  parseFavorites,
  FAVORITES_PAGE_SIZE,
} from '../../lib/favorites';
import type { SearchValues } from '../../lib/catalogue/model';
import { ProductCard, ShopCard } from '../../components/cards';
import { FavoriteButton, FavoritesSync } from '../../components/favorites';
import { ButtonLink, EmptyState } from '../../components/ui';
import styles from '../../components/market.module.css';
export const metadata: Metadata = {
  title: 'Избранное',
  robots: { index: false, follow: false },
};
export default async function FavoritesPage({
  searchParams,
}: {
  searchParams: Promise<SearchValues>;
}) {
  const query = await searchParams;
  const selection = parseFavorites(
    ['product', 'shop'].flatMap((kind) => {
      const value = query[kind];
      return (typeof value === 'string' ? [value] : (value ?? [])).map(
        (slug) => ({ kind, slug }),
      );
    }),
  );
  const pages = Math.max(1, Math.ceil(selection.length / FAVORITES_PAGE_SIZE));
  const page = Math.min(
    pages,
    typeof query.page === 'string' && /^[1-3]$/.test(query.page)
      ? Number(query.page)
      : 1,
  );
  const items = await readSavedItems(
    selection.slice(
      (page - 1) * FAVORITES_PAGE_SIZE,
      page * FAVORITES_PAGE_SIZE,
    ),
  );
  const scope = catalogueMode() === 'fixtures' ? 'demo' : 'live';
  return (
    <main
      id="main-content"
      className={'container catalogue-page ' + styles.surface}
    >
      <nav className="breadcrumbs" aria-label="Хлебные крошки">
        <Link href="/">Главная</Link>
        <span aria-hidden="true">/</span>
        <span>Избранное</span>
      </nav>
      <div className="collection-intro">
        <p className="eyebrow">ВАШИ НАХОДКИ</p>
        <h1>Избранное</h1>
        <p>
          Сохраняйте понравившиеся товары и бутики, чтобы вернуться к ним позже.
          До 24 находок на этом устройстве — без регистрации.
        </p>
      </div>
      <FavoritesSync scope={scope} selection={selection} page={page}>
        {!selection.length ? (
          <EmptyState
            title="Сохраните то, что понравилось"
            description="Нажмите на сердечко в карточке товара или бутика — ваши находки появятся здесь."
            action={<ButtonLink href="/catalog">Перейти в каталог</ButtonLink>}
          />
        ) : (
          <>
            <div className="saved-grid">
              {items.map(({ entry, product, shop }) => (
                <div
                  key={entry.kind + entry.slug}
                  className={entry.kind === 'shop' ? 'saved-shop' : ''}
                >
                  {entry.kind === 'product' && product ? (
                    <ProductCard product={product} shop={shop} />
                  ) : entry.kind === 'shop' && shop ? (
                    <ShopCard shop={shop} />
                  ) : (
                    <div className="saved-unavailable">
                      <h2>Предложение сейчас недоступно</h2>
                      <p>
                        Магазин мог скрыть товар или временно закрыть витрину.
                      </p>
                      <FavoriteButton
                        {...entry}
                        name="Недоступное предложение"
                        scope={scope}
                        inline
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
            {pages > 1 && (
              <nav className="pagination" aria-label="Страницы избранного">
                {page > 1 && (
                  <ButtonLink
                    href={favoritesUrl(selection, page - 1)}
                    variant="secondary"
                  >
                    Назад
                  </ButtonLink>
                )}
                <span>
                  Страница {page} из {pages}
                </span>
                {page < pages && (
                  <ButtonLink
                    href={favoritesUrl(selection, page + 1)}
                    variant="secondary"
                  >
                    Далее
                  </ButtonLink>
                )}
              </nav>
            )}
          </>
        )}
      </FavoritesSync>
    </main>
  );
}
