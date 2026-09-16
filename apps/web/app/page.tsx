import Link from 'next/link';
import { getCatalogue, queryCatalogue } from '../lib/catalogue/repository';
import {
  categories,
  publicProducts,
  parseFilters,
} from '../lib/catalogue/model';
import { pageMetadata } from '../lib/seo';
import { SellerCta } from '../components/shell';
import { ProductCard, ShopCard } from '../components/cards';
import { Arrow, EmptyState } from '../components/ui';
import { Hero } from '../components/hero';
import { CategoryStrip } from '../components/market-navigation';
import { MarketIcon } from '../components/market-icons';
import styles from '../components/market.module.css';
export const metadata = pageMetadata(
  'Все бутики Караганды в одном месте',
  'Одежда, обувь, аксессуары, косметика, парфюмерия и многое другое от магазинов твоего города.',
  '/',
);
export default async function Home() {
  const data = await getCatalogue();
  const products = publicProducts(data);
  const shops = data.shops.filter((shop) => shop.status === 'ACTIVE');
  const discounts =
    data.mode === 'live'
      ? publicProducts(await queryCatalogue(parseFilters({ discount: 'true' })))
      : products;
  return (
    <main id="main-content" className={styles.home}>
      <Hero />
      <CategoryStrip categories={data.categories ?? categories} />
      <section className={styles.container + ' ' + styles.section} id="shops">
        <div className={styles.sectionHeading}>
          <h2>
            {data.mode === 'live' ? 'Бутики Караганды' : 'Популярные бутики'}
          </h2>
          <Link href="/catalog" aria-label="Смотреть все предложения бутиков">
            Смотреть все <Arrow />
          </Link>
        </div>
        {shops.length ? (
          <div className={styles.shopGrid}>
            {shops.slice(0, 4).map((shop) => (
              <ShopCard key={shop.slug} shop={shop} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Здесь будут бутики вашего города"
            description="Магазины появятся после проверки и подключения к QRG."
          />
        )}
      </section>
      <section className={styles.container + ' ' + styles.section}>
        <div className={styles.sectionHeading}>
          <h2>
            {data.mode === 'live' ? 'Товары бутиков' : 'Популярные товары'}
          </h2>
          <Link href="/catalog">
            Смотреть все <Arrow />
          </Link>
        </div>
        {products.length ? (
          <div className={styles.denseProducts}>
            {products.slice(0, 8).map((product) => (
              <ProductCard
                key={product.slug}
                product={product}
                shop={data.shops.find((shop) => shop.slug === product.shop)}
              />
            ))}
          </div>
        ) : (
          <EmptyState />
        )}
      </section>
      <div className={styles.container}>
        <details className={styles.moreCollections}>
          <summary>
            Новые поступления и скидки <MarketIcon name="chevron" size={16} />
          </summary>
          {[
            {
              title: 'Новые поступления',
              items: products.filter((p) => p.isNew).slice(0, 8),
              href: '/catalog?sort=new',
            },
            {
              title: 'Находки со скидкой',
              items: discounts
                .filter((p) => p.oldPrice && p.oldPrice > p.price)
                .slice(0, 8),
              href: '/catalog?discount=true',
            },
          ].map((section) => (
            <section key={section.title} className={styles.section}>
              <div className={styles.sectionHeading}>
                <h2>{section.title}</h2>
                <Link href={section.href}>
                  Смотреть все <Arrow />
                </Link>
              </div>
              {section.items.length ? (
                <div className={styles.denseProducts}>
                  {section.items.map((product) => (
                    <ProductCard
                      key={product.slug}
                      product={product}
                      shop={data.shops.find((s) => s.slug === product.shop)}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState />
              )}
            </section>
          ))}
        </details>
      </div>
      <SellerCta />
      <div className={styles.container}>
        <section id="how-it-works" className={styles.how}>
          <h2>Как работает QRG</h2>
          <ol>
            <li>
              <span>01</span>
              <div>
                <h3>Найдите своё</h3>
                <p>Выберите товар в каталоге магазинов Караганды.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Свяжитесь с бутиком</h3>
                <p>Уточните у продавца вариант, цену и наличие.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Покупайте напрямую</h3>
                <p>Оплата продавцу — без участия QRG.</p>
              </div>
            </li>
          </ol>
        </section>
      </div>
    </main>
  );
}
