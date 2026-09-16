'use client';
import Image from 'next/image';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui';
import { ImageUpload, mutate } from './forms';
export function ImageManager({
  path,
  csrf,
  images,
}: {
  path: string;
  csrf: string;
  images: { id: string; alt: string; position: number }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const sorted = [...images].sort((a, b) => a.position - b.position);
  async function move(id: string, target: number) {
    const ids = sorted.map((image) => image.id);
    ids.splice(ids.indexOf(id), 1);
    ids.splice(target, 0, id);
    setBusy(true);
    setMessage('');
    try {
      await mutate(path + '/image-order', 'PUT', { ids }, csrf);
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Не удалось изменить порядок.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (!window.confirm('Удалить фотографию товара?')) return;
    setBusy(true);
    setMessage('');
    try {
      await mutate(path + '/images/' + id, 'DELETE', {}, csrf);
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Не удалось удалить фотографию.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>Фотографии</h2>
      <p>
        Первая фотография будет основной. Для перестановки используйте кнопки —
        это работает и на телефоне.
      </p>
      <div className="seller-images">
        {sorted.map((image, index) => (
          <article key={image.id}>
            <Image
              src={'/api/seller/' + path + '/images/' + image.id + '/content'}
              width={200}
              height={200}
              alt={image.alt}
              unoptimized
            />
            <p>{index === 0 ? 'Главное фото' : 'Фото ' + (index + 1)}</p>
            <Button
              type="button"
              disabled={busy || index === 0}
              variant="quiet"
              onClick={() => void move(image.id, 0)}
            >
              Сделать главным
            </Button>
            <Button
              type="button"
              disabled={busy || index === 0}
              variant="quiet"
              onClick={() => void move(image.id, index - 1)}
            >
              Раньше
            </Button>
            <Button
              type="button"
              disabled={busy || index === sorted.length - 1}
              variant="quiet"
              onClick={() => void move(image.id, index + 1)}
            >
              Позже
            </Button>
            <Button
              type="button"
              disabled={busy}
              variant="quiet"
              onClick={() => void remove(image.id)}
            >
              Удалить фото
            </Button>
          </article>
        ))}
      </div>
      <ImageUpload path={path + '/images'} csrf={csrf} count={images.length} />
      <p role="alert">{message}</p>
    </section>
  );
}
