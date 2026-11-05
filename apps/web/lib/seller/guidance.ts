/** Presentation only. API authorization and publication decisions remain server-side. */
export function shopGuidance(status: string) {
  switch (status) {
    case 'ACTIVE':
      return {
        title: 'Магазин открыт покупателям',
        description:
          'Поддерживайте актуальные цены, фотографии и наличие. Заявки покупателей появятся в разделе «Заявки».',
        section: 'products',
        action: 'Управлять товарами',
      };
    case 'PENDING_VERIFICATION':
      return {
        title: 'Магазин отправлен на проверку',
        description:
          'Дождитесь решения администратора. Пока можно добавлять товары и фотографии. Магазин станет публичным после проверки и оплаты подписки.',
        section: 'shop',
        action: 'Посмотреть статус проверки',
      };
    case 'VERIFIED':
      return {
        title: 'Проверка пройдена — осталось активировать подписку',
        description:
          'Данные магазина одобрены. Для появления в каталоге нужна действующая подписка QRG BUSINESS. Сохранённые товары и фотографии не потеряются.',
        section: 'subscription',
        action: 'Открыть подписку',
      };
    case 'CHANGES_REQUESTED':
      return {
        title: 'Нужно исправить сведения о магазине',
        description:
          'Прочитайте замечание администратора в разделе «Магазин», исправьте данные и отправьте их на повторную проверку.',
        section: 'shop',
        action: 'Посмотреть замечания',
      };
    case 'REJECTED':
      return {
        title: 'Магазин не прошёл проверку',
        description:
          'Причина отказа указана в разделе «Магазин». Исправьте сведения перед повторной отправкой. Сейчас бутик скрыт от покупателей.',
        section: 'shop',
        action: 'Посмотреть причину',
      };
    case 'SUSPENDED':
      return {
        title: 'Публичная витрина приостановлена',
        description:
          'Товары и фотографии сохранены, кабинет доступен. Проверьте решение администратора и состояние подписки: восстановление зависит от причины приостановки.',
        section: 'shop',
        action: 'Проверить причину',
      };
    default:
      return {
        title: 'Магазин пока виден только вам и вашей команде',
        description:
          'Заполните адрес и телефон, добавьте товары с фотографиями и отправьте магазин на проверку. Для открытия витрины также нужна действующая подписка.',
        section: 'shop',
        action: 'Настроить магазин',
      };
  }
}

export function imageSelectionError(
  file: { size: number; type: string } | null,
): string | null {
  if (!file || file.size === 0) return 'Выберите непустую фотографию.';
  if (file.size > 10 * 1024 * 1024)
    return 'Файл слишком большой. Выберите фотографию до 10 MB.';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    return 'Выберите JPEG, PNG или WEBP. SVG и другие форматы не поддерживаются.';
  return null;
}

export function subscriptionLabel(
  status: string,
  periodStart: unknown,
): string {
  if (status === 'SUSPENDED' && !periodStart)
    return 'Ещё не оплачена — витрина скрыта';
  const labels: Record<string, string> = {
    ACTIVE: 'Активна',
    PAST_DUE: 'Платёж не прошёл',
    GRACE: 'Льготный период',
    SUSPENDED: 'Приостановлена',
    CANCELLED: 'Отменена',
  };
  return labels[status] ?? 'Статус уточняется';
}
