export const shopStatuses = [
  { value: 'DRAFT', label: 'Черновик' },
  { value: 'PENDING_VERIFICATION', label: 'На проверке' },
  { value: 'CHANGES_REQUESTED', label: 'Нужны изменения' },
  { value: 'VERIFIED', label: 'Проверен, ожидает активации' },
  { value: 'ACTIVE', label: 'Активен' },
  { value: 'SUSPENDED', label: 'Приостановлен' },
  { value: 'REJECTED', label: 'Отказ' },
];
export const shopStatusLabel = (v: string) =>
  shopStatuses.find((s) => s.value === v)?.label ?? v;
const moderationReasonTemplates: Record<string, readonly string[]> = {
  REQUEST_CHANGES: [
    'Уточните или дополните контакты магазина.',
    'Добавьте адрес и ссылку на карточку магазина в 2GIS.',
    'Загрузите логотип, обложку и фотографии товаров без чужих водяных знаков.',
    'Исправьте описание магазина: укажите ассортимент и условия работы.',
  ],
  REJECT: [
    'Сведения о магазине не удалось подтвердить. Проверьте контакты и подайте заявку повторно.',
    'Магазин не соответствует правилам размещения QRG MARKET.',
  ],
  SUSPEND: [
    'Магазин временно скрыт до уточнения информации и устранения нарушения правил.',
    'Требуется подтвердить актуальность ассортимента, цен и контактов.',
  ],
  RESTORE: ['Проверка завершена: магазин восстановлен в кабинете продавца.'],
};
export function moderationReasonTemplatesFor(action: string) {
  return moderationReasonTemplates[action] ?? [];
}
export function moderationActions(status: string, permissions: string[]) {
  const choices = [
    {
      value: 'RESTORE',
      label: 'Восстановить после приостановки',
      from: ['SUSPENDED'],
      permission: 'moderation.suspend',
    },
    {
      value: 'APPROVE',
      label: 'Одобрить проверку',
      from: ['PENDING_VERIFICATION'],
      permission: 'moderation.write',
    },
    {
      value: 'REQUEST_CHANGES',
      label: 'Запросить изменения',
      from: ['PENDING_VERIFICATION', 'VERIFIED', 'ACTIVE', 'SUSPENDED'],
      permission: 'moderation.write',
    },
    {
      value: 'REJECT',
      label: 'Отказать',
      from: ['PENDING_VERIFICATION'],
      permission: 'moderation.write',
    },
    {
      value: 'SUSPEND',
      label: 'Приостановить',
      from: ['PENDING_VERIFICATION', 'VERIFIED', 'ACTIVE'],
      permission: 'moderation.suspend',
    },
  ];
  return choices
    .filter(
      (c) => c.from.includes(status) && permissions.includes(c.permission),
    )
    .map(({ value, label }) => ({ value, label }));
}
