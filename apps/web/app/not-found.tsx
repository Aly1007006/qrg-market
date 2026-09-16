import { ButtonLink } from '../components/ui';
export default function NotFound() {
  return (
    <main id="main-content" className="container not-found">
      <p className="eyebrow">404 · СТРАНИЦА НЕ НАЙДЕНА</p>
      <h1>
        Эту находку
        <br />
        не удалось найти
      </h1>
      <p>Возможно, ссылка изменилась или предложение больше не доступно.</p>
      <ButtonLink href="/catalog">Вернуться в каталог</ButtonLink>
    </main>
  );
}
