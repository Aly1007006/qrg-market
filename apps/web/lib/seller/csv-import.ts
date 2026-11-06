export type ImportOption = { id: string; name: string };
export type ProductImportRow = {
  line: number;
  name: string;
  categoryId: string;
  brandId: string | null;
  description: string;
  basePrice: number;
  oldPrice: number | null;
  variant: {
    size: string | null;
    color: string | null;
    sku: string | null;
    available: boolean;
  };
};
export type ProductImportResult = {
  rows: ProductImportRow[];
  errors: string[];
};

const requiredHeaders = ['name', 'category', 'price'] as const;
const optionalHeaders = [
  'brand',
  'old_price',
  'description',
  'size',
  'color',
  'sku',
  'available',
] as const;
const allHeaders = new Set([...requiredHeaders, ...optionalHeaders]);

function csvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
      continue;
    }
    if (char === ';' && !quoted) {
      row.push(value.trim());
      value = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = '';
      continue;
    }
    value += char;
  }
  if (quoted) throw new Error('Не закрыта кавычка в CSV.');
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
function numberValue(value: string, field: string, line: number) {
  const normalized = value.replace(',', '.').trim();
  if (!/^(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,2})?$/.test(normalized))
    throw new Error('Строка ' + line + ': «' + field + '» — некорректная цена.');
  const number = Number(normalized);
  if (!Number.isFinite(number) || number > 99999999.99)
    throw new Error('Строка ' + line + ': цена вне допустимого диапазона.');
  return number;
}
function optionId(value: string, options: ImportOption[]) {
  const normalized = value.trim().toLocaleLowerCase('ru-RU');
  return options.find(
    (option) =>
      option.id === value.trim() ||
      option.name.trim().toLocaleLowerCase('ru-RU') === normalized,
  )?.id;
}
function cell(values: Record<string, string>, header: string) {
  return values[header]?.trim() ?? '';
}
export function parseProductImport(
  text: string,
  categories: ImportOption[],
  brands: ImportOption[],
): ProductImportResult {
  if (text.length > 256 * 1024)
    return { rows: [], errors: ['Файл больше 256 KB. Разделите его на несколько файлов.'] };
  let rows: string[][];
  try {
    rows = csvRows(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    return {
      rows: [],
      errors: [error instanceof Error ? error.message : 'Не удалось прочитать CSV.'],
    };
  }
  if (!rows.length) return { rows: [], errors: ['Файл CSV пуст.'] };
  const headers = rows[0]!.map((header) => header.trim().toLowerCase());
  const duplicate = headers.find((header, index) => headers.indexOf(header) !== index);
  const unsupported = headers.find((header) => !allHeaders.has(header));
  const missing = requiredHeaders.find((header) => !headers.includes(header));
  if (duplicate) return { rows: [], errors: ['Столбец «' + duplicate + '» указан дважды.'] };
  if (unsupported)
    return { rows: [], errors: ['Неизвестный столбец «' + unsupported + '». Используйте скачанный шаблон.'] };
  if (missing)
    return { rows: [], errors: ['Не хватает обязательного столбца «' + missing + '».'] };
  if (rows.length - 1 > 50)
    return { rows: [], errors: ['В одном файле разрешено до 50 товаров.'] };
  const parsed: ProductImportRow[] = [];
  const errors: string[] = [];
  rows.slice(1).forEach((cells, offset) => {
    const line = offset + 2;
    try {
      const values = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
      const name = cell(values, 'name');
      const category = optionId(cell(values, 'category'), categories);
      const brandValue = cell(values, 'brand');
      const brand = brandValue ? optionId(brandValue, brands) : null;
      const description = cell(values, 'description');
      const size = cell(values, 'size') || null;
      const color = cell(values, 'color') || null;
      const sku = cell(values, 'sku') || null;
      if (!name || name.length > 200) throw new Error('Строка ' + line + ': название обязательно и не длиннее 200 символов.');
      if (!category) throw new Error('Строка ' + line + ': категория не найдена.');
      if (brandValue && !brand) throw new Error('Строка ' + line + ': бренд не найден.');
      if (description.length > 10000 || (size && size.length > 40) || (color && color.length > 40) || (sku && sku.length > 100))
        throw new Error('Строка ' + line + ': одно из текстовых полей слишком длинное.');
      const basePrice = numberValue(cell(values, 'price'), 'price', line);
      const oldValue = cell(values, 'old_price');
      const oldPrice = oldValue ? numberValue(oldValue, 'old_price', line) : null;
      if (oldPrice != null && oldPrice <= basePrice)
        throw new Error('Строка ' + line + ': прежняя цена должна быть выше текущей.');
      const availability = cell(values, 'available').toLowerCase();
      const available = availability === '' || ['да', 'true', '1', 'yes'].includes(availability)
        ? true
        : ['нет', 'false', '0', 'no'].includes(availability)
          ? false
          : (() => { throw new Error('Строка ' + line + ': «available» — используйте да или нет.'); })();
      parsed.push({ line, name, categoryId: category, brandId: brand, description, basePrice, oldPrice, variant: { size, color, sku, available } });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Строка ' + line + ': ошибка.');
    }
  });
  return { rows: parsed, errors };
}
export function importedProductSlug() {
  return 'import-' + crypto.randomUUID();
}
export const productImportTemplate =
  'name;category;brand;price;old_price;description;size;color;sku;available\n' +
  'Платье миди;Женщинам;;18990;22990;Лёгкое платье для повседневного образа;M;чёрный;DRESS-001;да\n';
