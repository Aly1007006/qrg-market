export interface Category {
  slug: string;
  name: string;
  note: string;
}
export const categories: readonly Category[] = [
  { slug: 'women', name: 'Женщинам', note: 'Одежда и детали образа' },
  { slug: 'men', name: 'Мужчинам', note: 'На каждый день' },
  { slug: 'shoes', name: 'Обувь', note: 'В своём ритме' },
  { slug: 'accessories', name: 'Аксессуары', note: 'Акцент на деталях' },
  { slug: 'beauty', name: 'Красота', note: 'Косметика и парфюмерия' },
];
export interface Shop {
  logo?: string;
  whatsappPhone?: string | null;
  address?: string;
  twoGisUrl?: string | null;
  demo?: boolean;
  slug: string;
  name: string;
  description: string;
  image: string;
  category: string;
  mall: string;
  status: 'ACTIVE' | 'DRAFT' | 'SUSPENDED';
}
export interface Variant {
  id: string;
  size: string;
  color: string;
  available: boolean;
  price: number;
}
export interface Product {
  id?: string;
  images?: { url: string; alt: string }[];
  demo?: boolean;
  shopDetails?: Shop;
  imageKey?: string | null;
  slug: string;
  name: string;
  description: string;
  category: string;
  subcategory: string;
  brand: string;
  shop: string;
  image: string;
  imageAlt: string;
  price: number;
  oldPrice?: number;
  isNew: boolean;
  variants: readonly Variant[];
}
export interface Catalogue {
  mode: 'fixtures' | 'unavailable' | 'live';
  categories?: readonly Category[];
  facets?: {
    shops: { slug: string; name: string }[];
    brands: string[];
    subcategories: string[];
    malls: string[];
    sizes: string[];
    colors: string[];
  };
  result?: { items: readonly Product[]; total: number; pages: number };
  products: readonly Product[];
  shops: readonly Shop[];
}
export type SearchValues = Record<string, string | string[] | undefined>;
export interface Filters {
  q: string;
  category: string;
  subcategory: string;
  brand: string;
  size: string;
  color: string;
  shop: string;
  mall: string;
  priceMin: string;
  priceMax: string;
  availability: string;
  discount: string;
  sort: string;
  page: number;
}
export const PAGE_SIZE = 8;
export const EMPTY_CATALOGUE: Catalogue = {
  mode: 'unavailable',
  products: [],
  shops: [],
};
export function fixturesEnabled(
  environment: string | undefined,
  flag: string | undefined,
) {
  return environment === 'development' && flag === 'true';
}
export function publicProducts(data: Catalogue) {
  const active = new Set(
    data.shops
      .filter((shop) => shop.status === 'ACTIVE')
      .map((shop) => shop.slug),
  );
  return data.products.filter((product) => active.has(product.shop));
}
export function parseFilters(values: SearchValues): Filters {
  const text = (key: string, max = 100) =>
    typeof values[key] === 'string' ? values[key].trim().slice(0, max) : '';
  const price = (key: string) =>
    /^\d{1,8}(?:[.]\d{1,2})?$/.test(text(key)) ? text(key) : '';
  const sort = text('sort');
  const page = text('page');
  return {
    q: text('q'),
    category: text('category'),
    subcategory: text('subcategory'),
    brand: text('brand'),
    size: text('size', 40),
    color: text('color', 40),
    shop: text('shop', 120),
    mall: text('mall', 150),
    priceMin: price('priceMin'),
    priceMax: price('priceMax'),
    availability: text('availability') === 'available' ? 'available' : '',
    discount: text('discount') === 'true' ? 'true' : '',
    sort: ['price-asc', 'price-desc', 'new'].includes(sort) ? sort : '',
    page: /^\d{1,4}$/.test(page)
      ? Math.max(1, Math.min(1000, Number(page)))
      : 1,
  };
}
export function filterProducts(data: Catalogue, filters: Filters) {
  const search = filters.q.toLocaleLowerCase('ru');
  const products = publicProducts(data).filter((product) => {
    const shop = data.shops.find((item) => item.slug === product.shop);
    const haystack = [
      product.name,
      product.description,
      product.brand,
      shop?.name,
      categories.find((item) => item.slug === product.category)?.name,
    ]
      .join(' ')
      .toLocaleLowerCase('ru');
    return (
      (!search || haystack.includes(search)) &&
      (!filters.category || product.category === filters.category) &&
      (!filters.subcategory || product.subcategory === filters.subcategory) &&
      (!filters.brand || product.brand === filters.brand) &&
      (!filters.shop || product.shop === filters.shop) &&
      (!filters.mall || shop?.mall === filters.mall) &&
      (!filters.discount ||
        (product.oldPrice !== undefined && product.oldPrice > product.price)) &&
      product.variants.some(
        (variant) =>
          (!filters.size || variant.size === filters.size) &&
          (!filters.color || variant.color === filters.color) &&
          (!filters.availability || variant.available) &&
          (!filters.priceMin || variant.price >= Number(filters.priceMin)) &&
          (!filters.priceMax || variant.price <= Number(filters.priceMax)),
      )
    );
  });
  if (filters.sort === 'price-asc') products.sort((a, b) => a.price - b.price);
  if (filters.sort === 'price-desc') products.sort((a, b) => b.price - a.price);
  if (filters.sort === 'new')
    products.sort((a, b) => Number(b.isNew) - Number(a.isNew));
  return {
    total: products.length,
    items: products.slice(
      (filters.page - 1) * PAGE_SIZE,
      filters.page * PAGE_SIZE,
    ),
    pages: Math.ceil(products.length / PAGE_SIZE),
  };
}
export function catalogueUrl(filters: Filters, changes: Partial<Filters> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...changes }))
    if (value && !(key === 'page' && value === 1))
      params.set(key, String(value));
  return '/catalog' + (params.size ? '?' + params : '');
}
export const money = (amount: number) =>
  new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 2 }).format(amount) +
  ' ₸';
