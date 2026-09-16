import Link from 'next/link';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  ReactNode,
} from 'react';
export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet';
}) {
  return (
    <button
      className={'button button-' + variant + ' ' + className}
      {...props}
    />
  );
}
export function ButtonLink({
  href,
  children,
  variant = 'primary',
  className = '',
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'quiet';
  className?: string;
}) {
  return (
    <Link href={href} className={'button button-' + variant + ' ' + className}>
      {children}
    </Link>
  );
}
export function Input({
  label,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} {...props} />
    </label>
  );
}
export function Select({
  label,
  id,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; id: string }) {
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} {...props}>
        {children}
      </select>
    </label>
  );
}
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'sand';
}) {
  return <span className={'badge badge-' + tone}>{children}</span>;
}
export function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={'skeleton ' + className} />;
}
export function EmptyState({
  title = 'Здесь пока нет товаров',
  description = 'Новые предложения появятся после подключения магазинов.',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="state-symbol" aria-hidden="true">
        —
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function ErrorState({ retry }: { retry: () => void }) {
  return (
    <div className="empty-state" role="alert">
      <h2>Не удалось загрузить страницу</h2>
      <p>
        Попробуйте ещё раз. Если ошибка повторится, вернитесь немного позже.
      </p>
      <Button onClick={retry}>Попробовать снова</Button>
    </div>
  );
}
export function LoadingState() {
  return (
    <div className="container loading-state" role="status" aria-live="polite">
      <span className="sr-only">Загружаем предложения…</span>
      <Skeleton className="skeleton-heading" />
      <div className="product-grid">
        {[1, 2, 3, 4].map((id) => (
          <div key={id}>
            <Skeleton className="skeleton-photo" />
            <Skeleton />
            <Skeleton />
          </div>
        ))}
      </div>
    </div>
  );
}
export function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <span aria-hidden="true">{diagonal ? '↗' : '→'}</span>;
}
