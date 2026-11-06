import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseProductImport,
  productImportTemplate,
} from "../lib/seller/csv-import.ts";

const category = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Женщинам",
};
const brand = { id: "00000000-0000-4000-8000-000000000002", name: "QRG Brand" };

test("CSV import accepts the template and creates drafts-only values", () => {
  const result = parseProductImport(productImportTemplate, [category], [brand]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.categoryId, category.id);
  assert.equal(result.rows[0]?.oldPrice, 22990);
  assert.equal(result.rows[0]?.variant.available, true);
});

test("CSV import rejects unknown category, invalid pricing and too many rows", () => {
  const invalid = parseProductImport(
    "name;category;price\nТовар;Нет такой категории;1000",
    [category],
    [],
  );
  assert.match(invalid.errors[0] ?? "", /категория не найдена/);
  const wrongPrice = parseProductImport(
    "name;category;price;old_price\nТовар;Женщинам;1000;900",
    [category],
    [],
  );
  assert.match(wrongPrice.errors[0] ?? "", /прежняя цена/);
  const rows = [
    "name;category;price",
    ...Array.from(
      { length: 51 },
      (_, index) => "Товар " + index + ";Женщинам;1000",
    ),
  ].join("\n");
  assert.match(
    parseProductImport(rows, [category], []).errors[0] ?? "",
    /до 50/,
  );
});
