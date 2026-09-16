import Image from 'next/image';
import Link from 'next/link';
import { sellerRead } from '../../lib/seller/server';
import { array, record, string } from '../../lib/catalogue/contract';
import { SellerForm, ImageUpload } from './forms';
export async function SellerOnboarding({
  shopId,
  csrf,
  role,
}: {
  shopId: string;
  csrf: string;
  role: string;
}) {
  const data = record(await sellerRead('shops/' + shopId + '/onboarding'));
  const checklist = record(data.checklist);
  const labels: Record<string, string> = {
    name: 'Заполнено название',
    logo: 'Добавлен логотип',
    cover: 'Добавлена обложка',
    whatsapp: 'Добавлен WhatsApp',
    twoGis: 'Добавлен 2GIS',
    firstProduct: 'Добавлен первый товар',
    fiveProducts: 'Добавлено минимум 5 товаров',
  };
  const href = '/seller/' + shopId;
  const owner = role === 'SHOP_OWNER';
  return (
    <section>
      {owner && !data.skipped && !data.completed && (
        <>
          <h2>Добро пожаловать в QRG MARKET</h2>
          <p>Настроим ваш бутик за несколько минут.</p>
          <ol>
            <li>
              <Link href={href + '/shop'}>Заполните информацию о магазине</Link>
            </li>
            <li>
              <Link href={href + '/shop#branding'}>
                Добавьте логотип и обложку
              </Link>
            </li>
            <li>
              <Link href={href + '/shop'}>Укажите WhatsApp и 2GIS</Link>
            </li>
            <li>
              <Link href={href + '/products/new'}>Добавьте первый товар</Link>
            </li>
            <li>
              <Link href={href + '/shop'}>Проверьте страницу бутика</Link>
            </li>
          </ol>
          <SellerForm
            csrf={csrf}
            method="PUT"
            path={'shops/' + shopId + '/onboarding'}
            fields={[
              { type: 'hidden', name: 'action', label: '', value: 'SKIP' },
            ]}
            label="Продолжить позже"
          />
        </>
      )}
      <h2>Подготовьте магазин к покупателям</h2>
      <p>
        Магазин заполнен на {Number(data.percent)}%. Это готовность оформления
        магазина.
      </p>
      <progress
        max={100}
        value={Number(data.percent)}
        aria-label="Готовность оформления магазина"
      />
      <ul>
        {Object.entries(labels).map(([key, label]) => (
          <li key={key}>
            {checklist[key] ? '✓ ' : '○ '}
            {label}
          </li>
        ))}
      </ul>
      {owner && data.skipped === true && !data.completed && (
        <SellerForm
          csrf={csrf}
          method="PUT"
          path={'shops/' + shopId + '/onboarding'}
          fields={[
            { type: 'hidden', name: 'action', label: '', value: 'RESUME' },
          ]}
          label="Продолжить настройку"
        />
      )}
      {data.status === 'ACTIVE' ? (
        <Link href={'/shop/' + string(data.shopSlug)}>Открыть свой бутик</Link>
      ) : (
        <p>
          Бутик ещё скрыт от покупателей. В разделе «Магазин» проверьте данные и
          отправьте его на проверку; публичность также зависит от действующей
          подписки.
        </p>
      )}
      <div className="seller-row">
        <Link className="button button-primary" href={href + '/products/new'}>
          Добавить товар
        </Link>
        <Link className="button button-secondary" href={href + '/products'}>
          Все товары
        </Link>
        <Link href={href + '/academy'}>Обучение</Link>
      </div>
    </section>
  );
}
export async function ShopBranding({
  shopId,
  csrf,
  editable,
}: {
  shopId: string;
  csrf: string;
  editable: boolean;
}) {
  const data = record(await sellerRead('shops/' + shopId + '/onboarding'));
  const images = array(data.images).map(record);
  return (
    <section id="branding">
      <h2>Логотип и обложка</h2>
      <fieldset disabled={!editable} className="editor-fields">
        {(['logo', 'cover'] as const).map((kind) => (
          <div key={kind}>
            <h3>{kind === 'logo' ? 'Логотип' : 'Обложка'}</h3>
            {images.some((image) => image.kind === kind) && (
              <Image
                src={
                  '/api/seller/shops/' +
                  shopId +
                  '/branding/' +
                  kind +
                  '/content'
                }
                alt={
                  kind === 'logo'
                    ? 'Логотип вашего магазина'
                    : 'Обложка вашего магазина'
                }
                width={280}
                height={180}
                style={{ objectFit: 'contain' }}
                unoptimized
              />
            )}
            <ImageUpload
              path={'shops/' + shopId + '/branding/' + kind + '/images'}
              csrf={csrf}
              count={0}
            />
          </div>
        ))}
      </fieldset>
      <p>
        Изображения сохраняются после проверки формата и удаления метаданных.
        Новый файл заменит прежний.
      </p>
      <SellerForm
        csrf={csrf}
        method="PUT"
        path={'shops/' + shopId + '/onboarding'}
        fields={[
          { type: 'hidden', name: 'action', label: '', value: 'REVIEW' },
        ]}
        label="Я проверил оформление магазина"
      />
    </section>
  );
}
