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
