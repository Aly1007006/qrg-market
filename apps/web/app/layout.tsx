import type { Metadata } from 'next';
import './globals.css';
import { Header, Footer, DemoNotice } from '../components/shell';
import { catalogueMode } from '../lib/catalogue/repository';
import { categories } from '../lib/catalogue/model';
import { AnalyticsClicks } from '../components/analytics';

export const metadata: Metadata = {
  title: { default: 'QRG MARKET', template: '%s · QRG MARKET' },
  description: 'Локальная цифровая витрина Караганды.',
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const mode = catalogueMode();
  return (
    <html lang="ru" data-scroll-behavior="smooth">
      <body>
        <Header categories={mode === 'fixtures' ? categories : []} />
        {mode !== 'live' && <DemoNotice demo={mode === 'fixtures'} />}
        {children}
        {mode === 'live' && <AnalyticsClicks />}
        <Footer />
      </body>
    </html>
  );
}
