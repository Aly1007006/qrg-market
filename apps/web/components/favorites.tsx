'use client';
import Link from 'next/link';
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  decodeFavorites,
  favoritesUrl,
  toggleFavorite,
  type Favorite,
  type FavoriteScope,
} from '../lib/favorites';
import { MarketIcon } from './market-icons';
import styles from './market.module.css';

const memory: Partial<Record<FavoriteScope, string>> = {};
const memoryOnly = new Set<FavoriteScope>();
const eventName = 'qrg-favorites-changed';
function key(scope: FavoriteScope) {
  return 'qrg:favorites:v1:' + scope;
}
function snapshot(scope: FavoriteScope) {
  if (typeof window === 'undefined') return '';
  if (memoryOnly.has(scope)) return memory[scope] ?? '';
  try {
    return window.localStorage.getItem(key(scope)) ?? '';
  } catch {
    return memory[scope] ?? '';
  }
}
function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(eventName, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(eventName, callback);
  };
}
function useFavorites(scope: FavoriteScope) {
  const raw = useSyncExternalStore(
    subscribe,
    () => snapshot(scope),
    () => '',
  );
  return decodeFavorites(raw);
}
export function FavoriteButton({
  kind,
  slug,
  name,
  scope,
  inline = false,
}: Favorite & {
  name: string;
  scope: FavoriteScope;
  inline?: boolean;
}) {
  const items = useFavorites(scope);
  const saved = items.some((item) => item.kind === kind && item.slug === slug);
  const [message, setMessage] = useState('');
  return (
    <>
      <button
        type="button"
        className={
          inline ? 'button button-secondary favorite-inline' : styles.favorite
        }
        aria-pressed={saved}
        aria-label={(saved ? 'Убрать из избранного: ' : 'В избранное: ') + name}
        onClick={() => {
          const raw = JSON.stringify(
            toggleFavorite(decodeFavorites(snapshot(scope)), { kind, slug }),
          );
          memory[scope] = raw;
          try {
            window.localStorage.setItem(key(scope), raw);
          } catch {
            memoryOnly.add(scope);
          }
          window.dispatchEvent(new Event(eventName));
          setMessage(
            memoryOnly.has(scope)
              ? 'Избранное доступно до закрытия этой вкладки: браузер запретил сохранение.'
              : saved
                ? 'Удалено из избранного.'
                : 'Сохранено в избранное на этом устройстве.',
          );
        }}
      >
        <MarketIcon name="heart" size={inline ? 20 : 18} />
        {inline && (saved ? 'В избранном' : 'В избранное')}
      </button>
      <span className="sr-only" role="status">
        {message}
      </span>
    </>
  );
}
export function FavoritesLink({ scope }: { scope: FavoriteScope }) {
  const items = useFavorites(scope);
  return (
    <Link
      href={favoritesUrl(items)}
      className={styles.favoritesLink}
      aria-label={'Избранное' + (items.length ? ': ' + items.length : '')}
    >
      <MarketIcon name="heart" />
      <span>Избранное</span>
      {items.length > 0 && (
        <span className="favorites-count">{items.length}</span>
      )}
    </Link>
  );
}
export function FavoritesSync({
  scope,
  selection,
  page,
  children,
}: {
  scope: FavoriteScope;
  selection: Favorite[];
  page: number;
  children: ReactNode;
}) {
  const router = useRouter();
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const raw = useSyncExternalStore(
    subscribe,
    () => snapshot(scope),
    () => '',
  );
  const expected = favoritesUrl(selection, page);
  useEffect(() => {
    if (!hydrated) return;
    const items = decodeFavorites(raw);
    const maxPage = Math.max(1, Math.ceil(items.length / 8));
    const target = favoritesUrl(items, Math.min(page, maxPage));
    if (target !== expected) router.replace(target, { scroll: false });
  }, [raw, expected, page, router, hydrated]);
  return <>{children}</>;
}
