import Link from 'next/link';
import { SearchInput } from './search';
import { Arrow } from './ui';
import { MobileDrawer } from './mobile-drawer';
import { MarketIcon } from './market-icons';
import { CategoryNav } from './market-navigation';
import type { Category } from '../lib/catalogue/model';
import styles from './market.module.css';
export function TopBar() {
  return (
    <div className={styles.topBar}>
      <div className={styles.container}>
        <span className={styles.city}>
          <MarketIcon name="pin" size={14} />
          Караганда
        </span>
        <span className={styles.topSlogan}>
          Все бутики твоего города — в одном месте
        </span>
        <div className={styles.topActions}>
          <span>Для покупателей — бесплатно</span>
          <Link href="/#for-sellers">Для продавцов</Link>
          <Link className={styles.topCta} href="/seller">
            Разместить бутик <Arrow />
          </Link>
        </div>
      </div>
    </div>
  );
}
export function Header({ categories }: { categories: readonly Category[] }) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Перейти к содержимому
      </a>
      <TopBar />
      <header className={styles.header + ' ' + styles.container}>
        <Link
          href="/"
          className={styles.wordmark}
          aria-label="QRG MARKET — главная"
        >
          QRG <span>MARKET</span>
        </Link>
        <div className={styles.headerSearch}>
          <SearchInput
            id="header-search"
            variant="header"
            placeholder="Поиск товаров, брендов или бутиков..."
          />
        </div>
        <nav
          className={styles.headerActions}
          aria-label="Личный кабинет и каталог"
        >
          <button
            type="button"
            disabled
            className={styles.favoritesLink}
            title="Избранное пока недоступно"
          >
            <MarketIcon name="heart" />
            <span>Избранное</span>
          </button>
          <Link
            className={styles.catalogIcon}
            href="/catalog"
            aria-label="Каталог товаров"
          >
            <MarketIcon name="bag" />
          </Link>
          <Link
            className={styles.login}
            href="/seller/login"
            title="Войти в кабинет продавца"
          >
            <MarketIcon name="user" />
            <span>Войти</span>
          </Link>
        </nav>
        <div className={styles.mobileMenu}>
          <MobileDrawer title="Меню" trigger="Меню">
            <nav className="drawer-nav" aria-label="Мобильная навигация">
              <Link href="/catalog">Каталог</Link>
              <Link href="/#shops">Бутики</Link>
              <Link href="/catalog?sort=new">Новинки</Link>
              <Link href="/catalog?discount=true">Скидки</Link>
              <Link href="/seller">Кабинет продавца</Link>
            </nav>
          </MobileDrawer>
        </div>
      </header>
      <CategoryNav categories={categories} />
    </>
  );
}
export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <Link href="/" className={styles.footerBrand}>
          QRG MARKET
        </Link>
        <nav aria-label="Навигация в подвале">
          <Link href="/catalog">Каталог</Link>
          <Link href="/#shops">Бутики города</Link>
          <Link href="/#how-it-works">Как работает QRG</Link>
          <Link href="/privacy/requests">Конфиденциальность</Link>
          <Link href="/seller">Кабинет продавца</Link>
        </nav>
        <p>
          © {new Date().getFullYear()} QRG MARKET · Караганда
          <br />
          Оплата товаров производится напрямую продавцу.
        </p>
      </div>
    </footer>
  );
}
export function Search({
  value = '',
  id = 'main-search',
}: {
  value?: string;
  id?: string;
}) {
  return <SearchInput key={value} value={value} id={id} />;
}
export function DemoNotice({ demo }: { demo: boolean }) {
  return (
    <div className={styles.notice}>
      <div className={styles.container}>
        {demo
          ? 'Демонстрационный режим: магазины, товары и цены — примеры, не реальные предложения.'
          : 'Витрина готовится к открытию. Реальные предложения магазинов пока не подключены.'}
      </div>
    </div>
  );
}
export function SellerCta() {
  return (
    <section id="for-sellers" className={styles.sellerCta}>
      <div className={styles.container}>
        <div className={styles.ctaCopy}>
          <h2>Есть магазин в Караганде?</h2>
          <p>
            Разместите свой бутик на QRG MARKET и привлекайте больше клиентов
          </p>
        </div>
        <ul>
          <li>
            <MarketIcon name="shield" />
            <span>
              Личный
              <br />
              кабинет
            </span>
          </li>
          <li>
            <MarketIcon name="bag" />
            <span>
              Размещение
              <br />
              товаров
            </span>
          </li>
          <li>
            <MarketIcon name="chart" />
            <span>
              Статистика
              <br />и заявки
            </span>
          </li>
          <li className={styles.ctaPrice}>10 000 ₸ / месяц</li>
        </ul>
        <Link className={styles.goldButton} href="/seller">
          Разместить бутик <Arrow />
        </Link>
      </div>
    </section>
  );
}
