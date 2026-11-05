import Link from 'next/link';
import {
  categories,
  publicProducts,
  type Catalogue,
  type Filters,
  catalogueUrl,
} from '../lib/catalogue/model';
import { Button, Input, Select } from './ui';
export function ActiveFilters({
  data,
  filters,
}: {
  data: Catalogue;
  filters: Filters;
}) {
  const labels: Partial<Record<keyof Filters, string>> = {
    q: 'Поиск',
    category: 'Категория',
    subcategory: 'Подкатегория',
    brand: 'Бренд',
    priceMin: 'Цена от',
    priceMax: 'Цена до',
    size: 'Размер',
    color: 'Цвет',
    shop: 'Бутик',
    mall: 'ТЦ',
    availability: 'В наличии',
    discount: 'Со скидкой',
  };
  const selected = (Object.keys(labels) as (keyof Filters)[]).filter(
    (key) => filters[key],
  );
  if (!selected.length) return null;
  return (
    <nav className="active-filters" aria-label="Выбранные фильтры">
      {selected.map((key) => {
        const raw = String(filters[key]);
        const value =
          key === 'category'
            ? ((data.categories ?? categories).find(
                (category) => category.slug === raw,
              )?.name ?? raw)
            : key === 'shop'
              ? ((data.facets?.shops ?? data.shops).find(
                  (shop) => shop.slug === raw,
                )?.name ?? raw)
              : key.startsWith('price')
                ? raw + ' ₸'
                : raw;
        const label =
          key === 'availability' || key === 'discount'
            ? labels[key]
            : labels[key] + ': ' + value;
        return (
          <Link
            key={key}
            href={catalogueUrl(filters, {
              [key]: '',
              ...(key === 'category' ? { subcategory: '' } : {}),
              page: 1,
            })}
            aria-label={'Убрать фильтр: ' + label}
          >
            {label}
            <span aria-hidden="true">✕</span>
          </Link>
        );
      })}
    </nav>
  );
}
export function FilterUI({
  data,
  filters,
  id,
}: {
  data: Catalogue;
  filters: Filters;
  id: string;
}) {
  const products = publicProducts(data);
  const unique = (items: readonly string[]) =>
    [...new Set(items)].sort((a, b) => a.localeCompare(b, 'ru'));
  const choices: {
    name: keyof Filters;
    label: string;
    options: { value: string; label: string }[];
  }[] = [
    {
      name: 'category',
      label: 'Категория',
      options: (data.categories ?? categories).map((item) => ({
        value: item.slug,
        label: item.name,
      })),
    },
    {
      name: 'subcategory',
      label: 'Подкатегория',
      options: unique(
        data.facets?.subcategories ??
          products
            .filter((p) => !filters.category || p.category === filters.category)
            .map((p) => p.subcategory),
      ).map((s) => ({ value: s, label: s })),
    },
    {
      name: 'brand',
      label: 'Бренд',
      options: unique(data.facets?.brands ?? products.map((p) => p.brand)).map(
        (s) => ({
          value: s,
          label: s,
        }),
      ),
    },
    {
      name: 'size',
      label: 'Размер / объём',
      options: unique(
        data.facets?.sizes ??
          products.flatMap((p) => p.variants.map((v) => v.size)),
      ).map((s) => ({ value: s, label: s })),
    },
    {
      name: 'color',
      label: 'Цвет',
      options: unique(
        data.facets?.colors ??
          products.flatMap((p) => p.variants.map((v) => v.color)),
      ).map((s) => ({ value: s, label: s })),
    },
    {
      name: 'shop',
      label: 'Бутик',
      options: (
        data.facets?.shops ?? data.shops.filter((s) => s.status === 'ACTIVE')
      ).map((s) => ({ value: s.slug, label: s.name })),
    },
    {
      name: 'mall',
      label: 'Торговый центр',
      options: unique(
        data.facets?.malls ??
          data.shops.filter((s) => s.status === 'ACTIVE').map((s) => s.mall),
      ).map((s) => ({ value: s, label: s })),
    },
  ];
  return (
    <form
      action="/catalog"
      method="get"
      className="filter-form"
      key={JSON.stringify(filters)}
      aria-label="Фильтры каталога"
    >
      <input type="hidden" name="q" value={filters.q} />
      <input type="hidden" name="sort" value={filters.sort} />
      {choices.map((choice, index) => (
        <div key={choice.name}>
          <Select
            id={id + '-' + choice.name}
            name={choice.name}
            label={choice.label}
            defaultValue={String(filters[choice.name])}
          >
            <option value="">Все</option>
            {filters[choice.name] &&
              !choice.options.some((o) => o.value === filters[choice.name]) && (
                <option value={filters[choice.name]}>
                  Выбрано: {filters[choice.name]}
                </option>
              )}
            {choice.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          {index === 2 && (
            <fieldset className="price-filter">
              <legend>Цена, ₸</legend>
              <Input
                id={id + '-min'}
                label="От"
                name="priceMin"
                type="number"
                min={0}
                step="0.01"
                max={99999999}
                defaultValue={filters.priceMin}
              />
              <Input
                id={id + '-max'}
                label="До"
                name="priceMax"
                type="number"
                min={0}
                step="0.01"
                max={99999999}
                defaultValue={filters.priceMax}
              />
            </fieldset>
          )}
        </div>
      ))}
      <label className="check">
        <input
          type="checkbox"
          name="availability"
          value="available"
          defaultChecked={filters.availability === 'available'}
        />
        В наличии
      </label>
      <label className="check">
        <input
          type="checkbox"
          name="discount"
          value="true"
          defaultChecked={filters.discount === 'true'}
        />
        Со скидкой
      </label>
      <Button type="submit">Применить фильтры</Button>
      <Link className="filter-reset" href="/catalog">
        Сбросить всё
      </Link>
    </form>
  );
}
export function SortUI({ filters }: { filters: Filters }) {
  return (
    <form
      action="/catalog"
      method="get"
      className="sort-form"
      key={JSON.stringify(filters)}
    >
      {Object.entries(filters)
        .filter(([key]) => key !== 'sort' && key !== 'page')
        .map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
      <Select
        id="catalog-sort"
        name="sort"
        label="Сортировка"
        defaultValue={filters.sort}
      >
        <option value="">По умолчанию</option>
        <option value="new">Сначала новинки</option>
        <option value="price-asc">Сначала дешевле</option>
        <option value="price-desc">Сначала дороже</option>
      </Select>
      <Button type="submit" variant="secondary">
        Применить
      </Button>
    </form>
  );
}
