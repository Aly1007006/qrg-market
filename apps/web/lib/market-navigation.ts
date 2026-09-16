import type { Category } from './catalogue/model.ts';
// Presentation only: absent departments use existing search, never invented taxonomy.
export const departments = [
  {
    name: 'Женская одежда',
    slugs: ['women', 'women-clothing'],
    query: 'женская одежда',
  },
  {
    name: 'Мужская одежда',
    slugs: ['men', 'men-clothing'],
    query: 'мужская одежда',
  },
  { name: 'Обувь', slugs: ['shoes'], query: 'обувь' },
  {
    name: 'Сумки и аксессуары',
    slugs: ['accessories', 'bags'],
    query: 'сумки',
  },
  { name: 'Украшения', slugs: ['jewelry'], query: 'украшения' },
  { name: 'Парфюмерия', slugs: ['perfume', 'perfumery'], query: 'парфюм' },
  { name: 'Косметика', slugs: ['cosmetics'], query: 'косметика' },
  { name: 'Детские товары', slugs: ['kids', 'children'], query: 'детские' },
  { name: 'Для дома', slugs: ['home'], query: 'для дома' },
  { name: 'Спорт', slugs: ['sport', 'sports'], query: 'спорт' },
] as const;
export function departmentLinks(categories: readonly Category[]) {
  return departments.map((department, index) => {
    const category = categories.find(
      (c) =>
        department.slugs.some((slug) => slug === c.slug) ||
        c.name.toLocaleLowerCase('ru') ===
          department.name.toLocaleLowerCase('ru'),
    );
    const query = new URLSearchParams(
      category ? { category: category.slug } : { q: department.query },
    );
    return { name: department.name, href: '/catalog?' + query, index };
  });
}
