export const requestStatuses = [
  { value: 'NEW', label: 'Новая' },
  { value: 'VIEWED', label: 'Просмотрена' },
  { value: 'CONTACTED', label: 'Связались с покупателем' },
  { value: 'CONFIRMED', label: 'Обращение подтверждено' },
  { value: 'CLOSED', label: 'Закрыта' },
  { value: 'REJECTED', label: 'Отклонена' },
];
export const REQUEST_PRIVACY_VERSION = 'request-privacy-v1';
export function whatsappLink(
  phone: string | null | undefined,
  product: string,
  variant: string,
) {
  if (!phone || !/^\+[1-9][0-9]{7,14}$/.test(phone)) return null;
  const text = `Здравствуйте! Нашёл у вас в QRG MARKET товар “${product}”, вариант “${variant || 'Стандартный вариант'}”. Подскажите, он ещё в наличии?`;
  return (
    'https://wa.me/' +
    phone.slice(1) +
    '?' +
    new URLSearchParams({ text }).toString()
  );
}
