import Image from 'next/image';
import Link from 'next/link';
import { readProduct } from '../../../lib/catalogue/repository';
import { pageMetadata, jsonLd } from '../../../lib/seo';
import { ProductOptions } from '../../../components/product-options';
import { Badge } from '../../../components/ui';
import { TwoGisLink } from '../../../components/two-gis-link';
import styles from '../../../components/market.module.css';
import { AnalyticsView } from '../../../components/analytics';
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props) {
  const { product } = await readProduct((await params).slug);
  return pageMetadata(
    product.name + (product.demo === false ? '' : ' — демо'),
    product.description,
    '/product/' + product.slug,
    product.demo === false ? product.image : undefined,
  );
}
export default async function ProductPage({ params }: Props) {
  const { product, shop } = await readProduct((await params).slug);
  return (
    <main
      id="main-content"
      className={'container detail-page ' + styles.surface}
    >
      {product.demo === false && (
        <>
          <AnalyticsView resource="product" slug={product.slug} />
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: jsonLd({
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: product.name,
                description: product.description,
              }),
            }}
          />
        </>
      )}
      <nav className="breadcrumbs" aria-label="Хлебные крошки">
        <Link href="/">Главная</Link>
        <span aria-hidden="true">/</span>
        <Link href="/catalog">Каталог</Link>
        <span aria-hidden="true">/</span>
        <span>{product.name}</span>
      </nav>
      <div className="product-detail">
        <div>
          <div className="detail-photo">
            {product.image ? (
              <Image
                src={product.image}
                unoptimized={product.image.startsWith('/api/images/')}
                alt={product.imageAlt}
                fill
                sizes="(max-width: 760px) 92vw, 50vw"
                loading="eager"
                fetchPriority="high"
              />
            ) : (
              <span className="no-photo">Фото пока не добавлено</span>
            )}
          </div>
          {product.images && product.images.length > 1 && (
            <div className="product-gallery" aria-label="Фотографии товара">
              {product.images.slice(1).map((photo) => (
                <Image
                  key={photo.url}
                  src={photo.url}
                  unoptimized={photo.url.startsWith('/api/images/')}
                  alt={photo.alt || product.name}
                  width={400}
                  height={500}
                  sizes="(max-width: 760px) 44vw, 24vw"
                />
              ))}
            </div>
          )}
          {product.demo !== false && (
            <p className="photo-note">
              Иллюстративная фотография. Не реальное предложение магазина.
            </p>
          )}
        </div>
        <section className="product-info" aria-labelledby="product-title">
          {product.demo !== false && <Badge>Демонстрационный товар</Badge>}
          <p className="eyebrow product-brand">{product.brand}</p>
          <h1 id="product-title">{product.name}</h1>
          <ProductOptions product={product} />
          <p className="payment-note">
            Оплата производится напрямую продавцу. QRG MARKET не принимает
            оплату за данный товар.
          </p>
          <div className="seller-summary">
            <p className="eyebrow">МАГАЗИН</p>
            <Link className="text-link" href={'/shop/' + shop.slug}>
              {shop.name}
              {shop.demo === false ? ' →' : ' — демо →'}
            </Link>
            <p>
              Караганда · {shop.mall}
              <br />
              {shop.address ||
                'Адрес и режим работы появятся после проверки магазина.'}
            </p>
            <TwoGisLink
              url={shop.twoGisUrl}
              analytics={{ resource: 'product', slug: product.slug }}
            />
          </div>
        </section>
      </div>
      <section className="product-description">
        <h2>О товаре</h2>
        <p>{product.description}</p>
        <dl className="specs">
          <div>
            <dt>Категория</dt>
            <dd>{product.subcategory}</dd>
          </div>
          <div>
            <dt>Бренд</dt>
            <dd>{product.brand}</dd>
          </div>
          <div>
            <dt>Характеристики</dt>
            <dd>Будут указаны продавцом для реального товара</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
