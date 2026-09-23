import Link from 'next/link';
import type { Category } from '../lib/catalogue/model';
import { departmentLinks } from '../lib/market-navigation';
import { CategoryCard } from './cards';
import styles from './market.module.css';
export function CategoryNav({
  categories,
}: {
  categories: readonly Category[];
}) {
  return (
    <nav className={styles.categoryNav} aria-label="Разделы каталога">
      <div className={styles.container}>
        {departmentLinks(categories).map((item) => (
          <Link key={item.name} href={item.href}>
            {item.name}
          </Link>
        ))}
      </div>
    </nav>
  );
}
export function CategoryStrip({
  categories,
}: {
  categories: readonly Category[];
}) {
  return (
    <nav
      className={styles.categoryStrip + ' ' + styles.container}
      aria-label="Выбрать категорию"
    >
      {departmentLinks(categories).map((item) => (
        <CategoryCard key={item.name} {...item} />
      ))}
    </nav>
  );
}
