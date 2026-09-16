'use client';
import { ErrorState } from '../components/ui';
export default function ErrorPage({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main id="main-content" className="container section">
      <ErrorState retry={retry} />
    </main>
  );
}
