import Link from 'next/link';
import { shopGuidance } from '../../lib/seller/guidance';

export function ShopNotice({
  shopId,
  status,
  role,
}: {
  shopId: string;
  status: string;
  role: string;
}) {
  const guidance = shopGuidance(status);
  return (
    <aside className="seller-next-step" aria-label="Следующий шаг для магазина">
      <div>
        <strong>{guidance.title}</strong>
        <p>{guidance.description}</p>
      </div>
      <Link
        className="button button-secondary"
        href={
          '/seller/' +
          shopId +
          '/' +
          (role === 'SHOP_OWNER' ? guidance.section : 'products')
        }
      >
        {role === 'SHOP_OWNER' ? guidance.action : 'Управлять товарами'}
      </Link>
    </aside>
  );
}
