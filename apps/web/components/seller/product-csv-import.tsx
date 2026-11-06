"use client";
import { useId, useState } from "react";
import { Button } from "../ui";
import {
  importedProductSlug,
  parseProductImport,
  productImportTemplate,
  type ImportOption,
  type ProductImportRow,
} from "../../lib/seller/csv-import";
import { mutate } from "./forms";

export function ProductCsvImport({
  shopId,
  csrf,
  categories,
  brands,
}: {
  shopId: string;
  csrf: string;
  categories: ImportOption[];
  brands: ImportOption[];
}) {
  const inputId = useId();
  const [rows, setRows] = useState<ProductImportRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  function downloadTemplate() {
    const url = URL.createObjectURL(
      new Blob([productImportTemplate], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "qrg-products-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function select(file: File | undefined) {
    setRows([]);
    setErrors([]);
    setMessage("");
    setConfirmed(false);
    if (!file) return;
    if (file.size > 256 * 1024) {
      setErrors(["Файл больше 256 KB. Разделите его на несколько файлов."]);
      return;
    }
    const result = parseProductImport(await file.text(), categories, brands);
    setRows(result.rows);
    setErrors(result.errors);
    if (!result.errors.length && result.rows.length)
      setMessage("Проверьте строки и подтвердите создание черновиков.");
  }

  async function submit() {
    if (!confirmed || !rows.length) return;
    setBusy(true);
    setMessage("");
    let created = 0;
    try {
      for (const row of rows) {
        await mutate(
          "shops/" + shopId + "/products",
          "POST",
          {
            name: row.name,
            slug: importedProductSlug(),
            categoryId: row.categoryId,
            brandId: row.brandId,
            description: row.description,
            basePrice: row.basePrice,
            oldPrice: row.oldPrice,
            status: "DRAFT",
            variants: [row.variant],
          },
          csrf,
        );
        created += 1;
      }
      setRows([]);
      setConfirmed(false);
      setMessage(
        "Создано черновиков: " +
          created +
          ". Добавьте фотографии и проверьте данные перед публикацией.",
      );
    } catch (error) {
      setMessage(
        "Создано черновиков: " +
          created +
          ". Остальные строки не добавлены: " +
          (error instanceof Error ? error.message : "ошибка сервера."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="seller-advanced">
      <summary>Добавить товары из CSV</summary>
      <p className="muted">
        Импорт создаёт до 50 товаров только как черновики. Фотографии не
        загружаются из CSV: добавьте их в карточках товаров перед публикацией.
      </p>
      <div className="seller-row">
        <Button type="button" variant="secondary" onClick={downloadTemplate}>
          Скачать шаблон CSV
        </Button>
        <label className="button button-secondary" htmlFor={inputId}>
          Выбрать CSV
          <input
            id={inputId}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(event) => void select(event.currentTarget.files?.[0])}
          />
        </label>
      </div>
      {errors.length > 0 && (
        <ul role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      {rows.length > 0 && !errors.length && (
        <>
          <p>Будет создано черновиков: {rows.length}</p>
          <ol>
            {rows.slice(0, 10).map((row) => (
              <li key={row.line}>
                {row.name} — {row.basePrice.toLocaleString("ru-RU")} ₸
              </li>
            ))}
          </ol>
          {rows.length > 10 && <p>И ещё {rows.length - 10} товаров.</p>}
          <label className="request-consent">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>Я проверил данные. Создать товары как черновики.</span>
          </label>
          <Button
            type="button"
            disabled={!confirmed || busy}
            onClick={() => void submit()}
          >
            {busy ? "Создаём черновики…" : "Создать черновики"}
          </Button>
        </>
      )}
      <p role="status">{message}</p>
    </details>
  );
}
