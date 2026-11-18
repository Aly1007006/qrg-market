import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'Admin Area',
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main-content" className="container seller-area admin-area">
      <header className="admin-masthead">
        <div>
          <p className="eyebrow">QRG MARKET / ADMIN AREA</p>
          <p className="admin-masthead-copy">Управление платформой</p>
        </div>
        <span className="admin-secure-mark">Защищённый доступ</span>
      </header>
      <div className="admin-shell">{children}</div>
    </main>
  );
}
