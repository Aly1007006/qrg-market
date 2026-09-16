# PHASE 7C — image assets и prompts

Режим: встроенный imagegen, без CLI и без новых API credentials. Все девять файлов сохранены в workspace. Это иллюстрации, не доказательство существования магазина или наличия товара. Hero/category art — оформление; карточки — development-only fixtures. Существующие фотографии и их provenance сохранены в `fixture-photo-sources.md`.

Пути ниже относительно корня репозитория. Prompts приведены в исходном английском тексте; для четырёх product images приведён общий шаблон и точные подстановки.

## Hero

`apps/web/public/brand/market-hero.png`

```text
Use case: photorealistic-natural. Asset type: QRG MARKET public website hero background, NOT a website screenshot. Create an ultra-wide landscape fashion lifestyle photograph, approximately 3:1. An adult Central Asian woman with dark hair in a warm taupe blazer over a black top, holding tasteful black shopping bags, standing outside a contemporary boutique arcade. Place her from the waist up at 66% of the image width, her face in the upper right half fully visible. Left 45% is softly out-of-focus darker storefront glass and architecture, with clear negative space for white HTML headline and search UI. Right background warm stone, boutique windows, muted city shopping atmosphere. Natural realistic skin, fabric texture, commercially polished editorial photography, warm neutral charcoal/sand palette. Match the composition of the supplied reference HERO only. No text, no signs, no logos, no typography, no user interface, no watermark. The photograph is illustrative, not a depiction of a real QRG store.
```

## Boutique covers

`apps/web/public/dev-fixtures/boutique-men.png`

```text
Use case: photorealistic-natural. Asset type: illustrative demo boutique cover photo for QRG MARKET. Wide landscape 3:2 composition, straight-on storefront view of a compact premium menswear boutique inside a shopping mall. Dark charcoal metal entrance framing, warm spotlights, orderly racks of shirts, jackets and mens clothing, natural realistic retail interior, no people, no text, no logos, no watermark. Commercial photography, muted warm neutral tones. A fictional illustrative store, not a real business.
```

`apps/web/public/dev-fixtures/boutique-bags.png`

```text
Use case: photorealistic-natural. Asset type: illustrative demo boutique cover photo for QRG MARKET. Wide landscape 3:2 composition, straight-on storefront view of a small elegant handbag and accessories boutique inside a shopping mall. Warm beige stone framing, softly lit wall shelves of black and tan handbags, glass entrance, realistic retail photography, no people, no text, no logos, no watermark. Muted warm neutral palette. Fictional illustrative store, not a real business.
```

`apps/web/public/dev-fixtures/boutique-beauty.png`

```text
Use case: photorealistic-natural. Asset type: illustrative demo boutique cover photo for QRG MARKET. Wide landscape 3:2 composition, straight-on storefront view of a small premium cosmetics and perfume boutique inside a shopping mall. Subtle dusty rose and warm cream interior, orderly shelves of perfume bottles and cosmetics, soft retail lighting, natural realistic commercial photography, no people, no readable labels, no signs, no text, no logos, no watermark. Fictional illustrative store, not a real business.
```

## Category sheet

`apps/web/public/brand/category-objects.png`

```text
Use case: product-mockup. Asset type: one website category icon sprite sheet. Precisely FIVE columns and TWO rows of equally-sized cells, 10 separate centered objects total, consistent soft very-light-gray background, no grid lines, no labels, no text. Top row left to right: coral women's dress, navy men's hoodie, white sneaker, black handbag, warm metal wristwatch. Bottom row left to right: amber perfume bottle, lipstick with small makeup brushes, brown teddy bear, light gray sofa, black dumbbell. Each object is fully visible inside its own cell with generous uniform padding, no overlap. Photorealistic miniature studio product photos with gentle shadows and clean silhouette, no logos or brand marks. Wide 3:1 overall sheet. Natural realistic materials, muted neutral palette. This is decorative category art, not actual products for sale.
```

## Product images

```text
Use case: product-mockup. Asset type: QRG MARKET development-only demo product photograph. Square image of {subject}, centered and fully visible, warm light-gray studio backdrop, soft natural shadow, commercially polished photorealistic product photography, realistic material texture. No typography, no labels, no logos, no watermark, no extra objects. Illustrative product only, not a real commercial offer.
```

| Файл                                      | Точная подстановка subject                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `apps/web/public/dev-fixtures/hoodie.png` | a plain black men's hoodie on an invisible mannequin, no model visible                |
| `apps/web/public/dev-fixtures/watch.png`  | a tasteful muted gold wristwatch                                                      |
| `apps/web/public/dev-fixtures/dress.png`  | a sand-colored elegant midi evening dress on an invisible mannequin, no model visible |
| `apps/web/public/dev-fixtures/kids.png`   | a neatly arranged beige two-piece child's tracksuit                                   |
