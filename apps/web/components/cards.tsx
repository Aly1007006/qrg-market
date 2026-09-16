import Image from 'next/image';
import Link from 'next/link';
import { money, type Product, type Shop } from '../lib/catalogue/model';
import { MarketIcon } from './market-icons';
import { TwoGisLink } from './two-gis-link';
import styles from './market.module.css';
function FavoritePlaceholder({ name }: { name: string }) {
  return (
    <button
      className={styles.favorite}
      type="button"
      disabled
      title="Избранное пока недоступно"
      aria-label={'Избранное пока недоступно: ' + name}
    >
      <MarketIcon name="heart" size={18} />
    </button>
  );
}
export function ProductCard({
  product,
  shop,
}: {
  product: Product;
  shop: Shop | undefined;
}) {
  return (
    <article className={styles.productCard}>
      <Link href={'/product/' + product.slug} className={styles.productLink}>
        <div className={styles.productPhoto}>
          {product.image ? (
            <Image
              src={product.image}
              unoptimized={product.image.startsWith('/api/images/')}
              alt={product.imageAlt}
              fill
              sizes="(max-width: 600px) 46vw, (max-width: 1000px) 23vw, 16vw"
            />
          ) : (
            <span className="no-photo">Фото пока не добавлено</span>
          )}
        </div>
        <div className={styles.productCopy}>
          <h3>{product.name}</h3>
          <div className={styles.price}>
            <strong>{money(product.price)}</strong>
            {product.oldPrice && product.oldPrice > product.price && (
              <del>{money(product.oldPrice)}</del>
            )}
          </div>
          <p>
            {shop?.name ?? 'Магазин'}
            {product.demo !== false ? ' · демо' : ''}
          </p>
        </div>
      </Link>
      <FavoritePlaceholder name={product.name} />
    </article>
  );
}
export function ShopCard({ shop }: { shop: Shop }) {
  const demo = shop.demo !== false;
  return (
    <article className={styles.shopCard}>
      <Link
        href={'/shop/' + shop.slug}
        className={styles.shopPhoto}
        aria-label={'Перейти в бутик ' + shop.name}
      >
        {shop.image ? (
          <Image
            src={shop.image}
            unoptimized={shop.image.startsWith('/api/images/')}
            alt={(demo ? 'Иллюстрация демо-бутика ' : 'Бутик ') + shop.name}
            fill
            sizes="(max-width: 600px) 92vw, (max-width: 1000px) 46vw, 24vw"
          />
        ) : (
          <span className="no-photo">Фото пока не добавлено</span>
        )}
      </Link>
      <FavoritePlaceholder name={shop.name} />
      <div className={styles.shopBody}>
        <div className={styles.shopIdentity}>
          <span className={styles.shopLogo} aria-hidden="true">
            {shop.logo ? (
              <Image
                src={shop.logo}
                alt=""
                width={48}
                height={48}
                unoptimized
              />
            ) : (
              shop.name.slice(0, 2)
            )}
          </span>
          <div>
            <Link href={'/shop/' + shop.slug}>
              <h3>{shop.name}</h3>
            </Link>
            <p>{shop.category}</p>
          </div>
        </div>
        {demo && (
          <span className={styles.demoTag}>
            Демо-бутик · не реальный магазин
          </span>
        )}
        <p className={styles.shopAddress}>
          <MarketIcon name="pin" size={14} />
          <span>{shop.address || shop.mall || 'Адрес уточняется'}</span>
        </p>
        <p className={styles.shopHours}>
          <MarketIcon name="clock" size={14} />
          Режим работы пока не указан
        </p>
        <div className={styles.shopButtons}>
          <TwoGisLink
            url={demo ? undefined : shop.twoGisUrl}
            analytics={{ resource: 'shop', slug: shop.slug }}
          >
            <MarketIcon name="pin" size={14} />
            Найти на карте
          </TwoGisLink>
          <Link className="button button-secondary" href={'/shop/' + shop.slug}>
            Перейти в бутик
          </Link>
        </div>
      </div>
    </article>
  );
}
export function CategoryCard({
  name,
  href,
  index,
}: {
  name: string;
  href: string;
  index: number;
}) {
  return (
    <Link className={styles.categoryCard} href={href}>
      <span className={styles.categoryArt}>
        {index < 10 ? (
          <span className={styles.categoryCrop}>
            <Image
              src="/brand/category-objects.png"
              alt=""
              width={2164}
              height={727}
              sizes="640px"
              style={{
                position: 'absolute',
                width: '500%',
                height: '200%',
                maxWidth: 'none',
                left: -(index % 5) * 100 + '%',
                top: -Math.floor(index / 5) * 100 + '%',
              }}
            />
          </span>
        ) : (
          <MarketIcon name="more" size={30} />
        )}
      </span>
      <span>{name}</span>
    </Link>
  );
}
