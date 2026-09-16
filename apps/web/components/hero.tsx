import Image from 'next/image';
import { SearchInput } from './search';
import { MarketIcon } from './market-icons';
import styles from './market.module.css';
export function Hero() {
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <Image
        className={styles.heroPhoto}
        src="/brand/market-hero.png"
        alt=""
        fill
        sizes="100vw"
        loading="eager"
        fetchPriority="high"
      />
      <div className={styles.heroShade} />
      <div className={styles.container + ' ' + styles.heroInner}>
        <div className={styles.heroCopy}>
          <p className={styles.heroBrand}>QRG MARKET</p>
          <h1 id="hero-title">
            Все бутики Караганды
            <br />в одном месте
          </h1>
          <p className={styles.heroDescription}>
            Одежда, обувь, аксессуары, косметика и многое другое
            <br className={styles.desktopBreak} /> от любимых магазинов твоего
            города.
          </p>
          <SearchInput
            id="hero-search"
            variant="hero"
            placeholder="Например: платье, Nike, парфюм..."
          />
          <ul className={styles.heroBenefits}>
            <li>
              <MarketIcon name="bag" size={30} />
              <span>
                Реальные бутики
                <br />
                Караганды
              </span>
            </li>
            <li>
              <MarketIcon name="shield" size={30} />
              <span>
                Проверенные
                <br />
                продавцы
              </span>
            </li>
            <li>
              <MarketIcon name="pin" size={30} />
              <span>
                Найти на карте
                <br />в 2GIS
              </span>
            </li>
          </ul>
        </div>
        <div className={styles.localNote}>
          <MarketIcon name="pin" size={30} />
          <span>
            Поддерживаем
            <br />
            местный бизнес
            <br />
            Караганды <span aria-hidden="true">♥</span>
          </span>
        </div>
      </div>
    </section>
  );
}
