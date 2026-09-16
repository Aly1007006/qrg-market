'use client';
import { useState } from 'react';
import { money, type Product } from '../lib/catalogue/model';
import { Badge, Button, Select } from './ui';
import { CustomerRequestForm } from './customer-request-form';
import { whatsappLink } from '../lib/customer-requests';
export function ProductOptions({ product }: { product: Product }) {
  const [requestOpen, setRequestOpen] = useState(false);
  const [selected, setSelected] = useState(
    product.variants.find((v) => v.price === product.price)?.id ??
      product.variants[0]?.id ??
      '',
  );
  const variant = product.variants.find((v) => v.id === selected);
  const whatsapp =
    product.demo === false
      ? whatsappLink(
          product.shopDetails?.whatsappPhone,
          product.name,
          [variant?.size, variant?.color].filter(Boolean).join(' · '),
        )
      : null;
  return (
    <div className="product-options">
      <div className="detail-price" aria-live="polite">
        <strong>{money(variant?.price ?? product.price)}</strong>
        {product.oldPrice &&
          product.oldPrice > (variant?.price ?? product.price) && (
            <del>{money(product.oldPrice)}</del>
          )}
      </div>
      <Select
        id="product-variant"
        label="Размер и цвет"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
      >
        {product.variants.map((v) => (
          <option key={v.id} value={v.id}>
            {[v.size, v.color].filter(Boolean).join(' · ') ||
              'Стандартный вариант'}
            {!v.available ? ' · нет в наличии' : ''}
          </option>
        ))}
      </Select>
      <p className="availability" aria-live="polite">
        <Badge tone="sand">
          {variant?.available ? 'В наличии' : 'Нет в наличии'}
          {product.demo !== false ? ' · демо' : ''}
        </Badge>
      </p>
      <p className="muted">
        Наличие уточняйте у продавца. QRG не гарантирует фактический складской
        остаток. Продавец отвечает за актуальность наличия.
      </p>
      <div className="product-actions" aria-describedby="demo-actions-note">
        <Button
          disabled={product.demo !== false || !product.id}
          aria-expanded={requestOpen}
          aria-controls="customer-request-form"
          onClick={() => setRequestOpen((v) => !v)}
        >
          Заказать у продавца
        </Button>
        {whatsapp ? (
          <a
            className="button button-secondary"
            href={whatsapp}
            data-analytics-event="WHATSAPP_CLICK"
            data-analytics-resource="product"
            data-analytics-slug={product.slug}
            target="_blank"
            rel="noopener noreferrer"
          >
            Написать в WhatsApp
          </a>
        ) : (
          <Button disabled variant="secondary">
            Написать в WhatsApp
          </Button>
        )}
      </div>
      <p id="demo-actions-note" className="muted">
        {product.demo !== false
          ? 'Заявки и контакты недоступны для демо-товаров. Никакие данные не отправляются.'
          : 'Заявка передаётся только выбранному магазину. WhatsApp доступен, если продавец указал номер.'}
      </p>
      <div id="customer-request-form">
        {requestOpen && product.demo === false && (
          <CustomerRequestForm
            key={product.id}
            product={product}
            selected={selected}
          />
        )}
      </div>
    </div>
  );
}
