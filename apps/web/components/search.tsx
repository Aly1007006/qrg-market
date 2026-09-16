'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  nextSuggestion,
  parseSuggestions,
  type Suggestion,
} from '../lib/catalogue/suggestions';
import { MarketIcon } from './market-icons';
import styles from './market.module.css';
export function SearchInput({
  value = '',
  id = 'main-search',
  variant = 'default',
  placeholder = 'Товар, бренд или магазин',
}: {
  value?: string;
  id?: string;
  variant?: 'default' | 'header' | 'hero';
  placeholder?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(value);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  useEffect(() => {
    if (query.trim().length < 2 || !open) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void fetch('/api/search?q=' + encodeURIComponent(query.trim()), {
        signal: abort.signal,
        cache: 'no-store',
      })
        .then(async (r) => {
          if (!r.ok) throw new Error('Search unavailable');
          return parseSuggestions(await r.json());
        })
        .then((result) => {
          if (!abort.signal.aborted) {
            setItems(result);
            setStatus('ready');
          }
        })
        .catch(() => {
          if (!abort.signal.aborted) {
            setItems([]);
            setStatus('error');
          }
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, open]);
  const expanded = open && query.trim().length >= 2;
  return (
    <div
      className={
        'search-container ' +
        styles.searchWrap +
        ' ' +
        (variant === 'header'
          ? styles.headerSearchStyle
          : variant === 'hero'
            ? styles.heroSearchStyle
            : '')
      }
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <form action="/catalog" method="get" className="search" role="search">
        <span className={styles.searchLeading}>
          <MarketIcon name="search" />
        </span>
        <label className="sr-only" htmlFor={id}>
          Найти товар, бренд или магазин
        </label>
        <input
          id={id}
          name="q"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={id + '-options'}
          aria-activedescendant={
            expanded && active >= 0 ? id + '-option-' + active : undefined
          }
          autoComplete="off"
          maxLength={100}
          value={query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setItems([]);
            setActive(-1);
            setStatus(e.target.value.trim().length >= 2 ? 'loading' : 'idle');
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setOpen(false);
              setActive(-1);
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setOpen(true);
              setActive(nextSuggestion(active, e.key, items.length));
            }
            if (e.key === 'Enter' && expanded && active >= 0 && items[active]) {
              e.preventDefault();
              router.push('/product/' + items[active].slug);
              setOpen(false);
            }
          }}
        />
        <button
          className="button button-primary"
          type="submit"
          aria-label="Найти"
        >
          {variant === 'header' ? <MarketIcon name="search" /> : 'Найти'}
        </button>
      </form>
      {expanded && (
        <div className="suggestions">
          <ul id={id + '-options'} role="listbox" aria-label="Подсказки поиска">
            {items.map((item, i) => (
              <li
                role="option"
                aria-selected={active === i}
                id={id + '-option-' + i}
                key={item.slug}
              >
                <a
                  tabIndex={-1}
                  href={'/product/' + item.slug}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {item.name}
                </a>
              </li>
            ))}
          </ul>
          <p role="status">
            {status === 'loading'
              ? 'Ищем…'
              : status === 'error'
                ? 'Подсказки временно недоступны. Попробуйте поиск по кнопке.'
                : status === 'ready' && !items.length
                  ? 'Ничего не найдено'
                  : items.length
                    ? 'Используйте стрелки и Enter для выбора.'
                    : ''}
          </p>
        </div>
      )}
    </div>
  );
}
