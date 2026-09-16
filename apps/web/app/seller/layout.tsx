import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'Кабинет продавца',
  robots: { index: false, follow: false },
};
export default function SellerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main id="main-content" className="container seller-area">
      {children}
    </main>
  );
}
