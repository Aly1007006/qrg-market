'use client';
export default function GlobalError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="ru">
      <body>
        <main>
          <h1>QRG MARKET временно недоступен</h1>
          <p>Попробуйте загрузить страницу ещё раз.</p>
          <button onClick={retry}>Повторить</button>
        </main>
      </body>
    </html>
  );
}
