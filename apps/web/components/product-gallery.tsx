'use client';
import Image from 'next/image';
import { useId, useRef, useState } from 'react';
import { Button } from './ui';
export function ProductGallery({
  photos,
  name,
}: {
  photos: { url: string; alt: string }[];
  name: string;
}) {
  const [selected, setSelected] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const photo = photos[selected] ?? photos[0];
  const change = (direction: number) =>
    setSelected(
      (current) => (current + direction + photos.length) % photos.length,
    );
  if (!photo)
    return (
      <div className="detail-photo">
        <span className="no-photo">Фото пока не добавлено</span>
      </div>
    );
  return (
    <div
      className="gallery"
      onKeyDown={(event) => {
        if (
          photos.length < 2 ||
          (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
        )
          return;
        event.preventDefault();
        change(event.key === 'ArrowRight' ? 1 : -1);
      }}
    >
      <button
        ref={opener}
        type="button"
        className="detail-photo gallery-main"
        aria-label={'Увеличить фото: ' + name}
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <Image
          key={photo.url}
          src={photo.url}
          alt={photo.alt || name}
          unoptimized={photo.url.startsWith('/api/images/')}
          fill
          sizes="(max-width: 760px) 92vw, 50vw"
          loading="eager"
          fetchPriority="high"
        />
        <span className="gallery-hint">Увеличить ↗</span>
        {photos.length > 1 && (
          <span className="gallery-count">
            {selected + 1} / {photos.length}
          </span>
        )}
      </button>
      {photos.length > 1 && (
        <div
          className="gallery-thumbnails"
          role="group"
          aria-label="Фотографии товара"
        >
          {photos.map((item, index) => (
            <button
              key={item.url}
              type="button"
              aria-pressed={selected === index}
              aria-label={'Показать фото ' + (index + 1)}
              onClick={() => setSelected(index)}
            >
              <Image
                src={item.url}
                alt=""
                width={72}
                height={84}
                unoptimized={item.url.startsWith('/api/images/')}
              />
            </button>
          ))}
        </div>
      )}
      <dialog
        ref={dialog}
        className="gallery-dialog"
        aria-labelledby={titleId}
        onClose={() => opener.current?.focus()}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div className="gallery-dialog-heading">
          <h2 id={titleId}>{name}</h2>
          <Button
            type="button"
            variant="quiet"
            aria-label="Закрыть фотографии"
            onClick={() => dialog.current?.close()}
          >
            ✕
          </Button>
        </div>
        <div className="gallery-enlarged">
          <Image
            src={photo.url}
            alt={photo.alt || name}
            fill
            sizes="90vw"
            unoptimized={photo.url.startsWith('/api/images/')}
          />
        </div>
        {photos.length > 1 && (
          <div className="gallery-controls">
            <Button
              type="button"
              variant="secondary"
              onClick={() => change(-1)}
              aria-label="Предыдущее фото"
            >
              ←
            </Button>
            <span aria-live="polite">
              {selected + 1} / {photos.length}
            </span>
            <Button
              type="button"
              variant="secondary"
              onClick={() => change(1)}
              aria-label="Следующее фото"
            >
              →
            </Button>
          </div>
        )}
      </dialog>
    </div>
  );
}
