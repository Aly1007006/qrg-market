import Image from 'next/image';
import Link from 'next/link';
import { readShop } from '../../../lib/catalogue/repository';
import { publicProducts } from '../../../lib/catalogue/model';
import { pageMetadata, jsonLd } from '../../../lib/seo';
import { ProductCard } from '../../../components/cards';
import { Badge, Button, EmptyState } from '../../../components/ui';
import { TwoGisLink } from '../../../components/two-gis-link';
import styles from '../../../components/market.module.css';
import { AnalyticsView } from '../../../components/analytics';
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props) {
  const { shop } = await readShop((await params).slug);
  return pageMetadata(
    shop.name + (shop.demo === false ? '' : ' — демо-бутик'),
    shop.description,
    '/shop/' + shop.slug,
  );
}
export default async function ShopPage({ params }: Props) {
  const { shop, data } = await readShop((await params).slug);
  const whatsapp =
    shop.demo === false &&
    shop.whatsappPhone &&
    /^\+[1-9][0-9]{7,14}$/.test(shop.whatsappPhone)
      ? 'https://wa.me/' + shop.whatsappPhone.slice(1)
      : null;
  const products = publicProducts(data).filter((p) => p.shop === shop.slug);
  return (
    <main id="main-content" className={'container shop-page ' + styles.surface}>
      {shop.demo === false && (
        <>
          <AnalyticsView resource="shop" slug={shop.slug} />
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: jsonLd({
                '@context': 'https://schema.org',
                '@type': 'Store',
                name: shop.name,
                description: shop.description,
                ...(shop.address
                  ? {
                      address: {
                        '@type': 'PostalAddress',
                        streetAddress: shop.address,
                        addressLocality: 'Караганда',
                        addressCountry: 'KZ',
                      },
                    }
                  : {}),
              }),
            }}
          />
        </>
      )}
      <nav className="breadcrumbs" aria-label="Хлебные крошки">
        <Link href="/">Главная</Link>
        <span aria-hidden="true">/</span>
        <Link href="/#shops">Бутики</Link>
        <span aria-hidden="true">/</span>
        <span>{shop.name}</span>
      </nav>
      <div className="shop-cover">
        {shop.image ? (
          <Image
            src={shop.image}
            alt={
              (shop.demo === false
                ? 'Магазин '
                : 'Иллюстрация демо-магазина ') + shop.name
            }
            fill
            sizes="92vw"
            loading="eager"
            fetchPriority="high"
          />
        ) : (
          <span className="no-photo">Фото магазина пока не добавлено</span>
        )}
      </div>
      <section className="shop-intro">
        <div>
          <div className="shop-monogram" aria-hidden="true">
            {shop.name.slice(0, 1)}
          </div>
          {shop.demo !== false && (
            <Badge>Демо-магазин · не верифицирован</Badge>
          )}
          <h1>{shop.name}</h1>
          <p className="eyebrow">{shop.category}</p>
          <p>{shop.description}</p>
        </div>
        <div className="shop-contacts">
          <h2>Где нас найти</h2>
          <p>Караганда · {shop.mall}</p>
          <dl>
            <dt>Адрес</dt>
            <dd>{shop.address || 'Будет указан после проверки'}</dd>
            <dt>Режим работы</dt>
            <dd>Пока не указан</dd>
          </dl>
          <TwoGisLink
            url={shop.twoGisUrl}
            analytics={{ resource: 'shop', slug: shop.slug }}
          />
          {whatsapp ? (
            <a
              className="button button-secondary"
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              data-analytics-event="WHATSAPP_CLICK"
              data-analytics-resource="shop"
              data-analytics-slug={shop.slug}
            >
              Написать в WhatsApp
            </a>
          ) : (
            <Button disabled variant="secondary">
              Написать в WhatsApp
            </Button>
          )}
          {shop.demo !== false && (
            <p className="muted">У демо-магазина нет реальных контактов.</p>
          )}
        </div>
      </section>
      {[
        { title: 'Товары бутика', items: products },
        { title: 'Новое в магазине', items: products.filter((p) => p.isNew) },
        {
          title: 'Акции',
          items: products.filter((p) => p.oldPrice && p.oldPrice > p.price),
        },
      ].map((section) => (
        <section key={section.title} className="section">
          <div className="section-heading">
            <h2>{section.title}</h2>
            <Link href={'/catalog?shop=' + shop.slug}>В каталоге →</Link>
          </div>
          {section.items.length ? (
            <div className="product-grid">
              {section.items.map((p) => (
                <ProductCard key={p.slug} product={p} shop={shop} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="В этой подборке пока нет товаров"
              description="Посмотрите другие предложения магазина."
            />
          )}
        </section>
      ))}
    </main>
  );
}
