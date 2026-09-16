import { sellerRead } from '../../lib/seller/server';
import { array, record, string } from '../../lib/catalogue/contract';
import { shopStatusLabel } from '../../lib/moderation';
import { SellerForm } from './forms';
export async function SellerVerification({
  shopId,
  status,
  csrf,
}: {
  shopId: string;
  status: string;
  csrf: string;
}) {
  const history = array(
    await sellerRead('shops/' + shopId + '/verification'),
  ).map(record);
  return (
    <section aria-label="Проверка магазина">
      <h2>Проверка магазина</h2>
      <p>{shopStatusLabel(status)}</p>
      {['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'].includes(status) ? (
        <>
          <p>
            Перед отправкой укажите адрес и хотя бы один телефон. Администратор
            проверит сведения без сбора лишних документов.
          </p>
          <SellerForm
            path={'shops/' + shopId + '/verification'}
            csrf={csrf}
            label="Отправить на проверку"
          />
        </>
      ) : (
        <p>
          Название, адрес и контакты проверяемого магазина защищены от
          изменений. Для исправления проверенных сведений обратитесь к
          администратору; он вернёт магазин на доработку. VERIFIED не означает
          публичную активацию.
        </p>
      )}
      {history.length > 0 && (
        <>
          <h3>Последние решения</h3>
          {history.map((h) => (
            <article key={string(h.id)}>
              <p>
                {new Date(string(h.createdAt)).toLocaleString('ru-RU', {
                  timeZone: 'Asia/Almaty',
                })}{' '}
                · {shopStatusLabel(string(h.status))}
              </p>
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {string(h.reason) || 'Отправлено на проверку / без замечаний'}
              </p>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
