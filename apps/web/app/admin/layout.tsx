import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'Admin Area',
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main-content" className="container seller-area admin-area">
      <p className="eyebrow">QRG MARKET / ADMIN AREA</p>
      {children}
    </main>
  );
}
