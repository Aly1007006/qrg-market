import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { Database } from '../database.js';
import { CatalogQueryDto } from './dto.js';
import { subscriptionVisible } from '../subscriptions/visibility.js';

const joins = sql`FROM products p JOIN shops s ON s.id=p.shop_id JOIN categories c ON c.id=p.category_id LEFT JOIN categories pc ON pc.id=c.parent_id LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN shop_locations l ON l.shop_id=s.id`;
const visible = sql`p.status='PUBLISHED' AND s.status='ACTIVE' AND ${subscriptionVisible(sql`s.id`)}`;
const shopJson = sql`jsonb_build_object('slug',s.slug,'name',s.name,'description',s.description,'imageId',(SELECT id FROM shop_images WHERE shop_id=s.id AND kind='cover'),'logoId',(SELECT id FROM shop_images WHERE shop_id=s.id AND kind='logo'),'category','','mall',coalesce(l.mall,''),'address',coalesce(l.address,''),'twoGisUrl',l.two_gis_url,'whatsappPhone',(SELECT c.whatsapp_phone FROM shop_contacts c WHERE c.shop_id=s.id),'status',s.status)`;
const projection = (
  price: SQL,
) => sql`p.id,p.slug,p.name,p.description,coalesce(pc.slug,c.slug) AS category,CASE WHEN pc.id IS NULL THEN '' ELSE c.slug END AS subcategory,coalesce(b.name,'') AS brand,s.slug AS shop,'' AS image,coalesce((SELECT i.alt FROM product_images i WHERE i.product_id=p.id ORDER BY i.position LIMIT 1),p.name) AS "imageAlt",
(SELECT i.object_key FROM product_images i WHERE i.product_id=p.id ORDER BY i.position LIMIT 1) AS "imageKey",
(SELECT i.id FROM product_images i WHERE i.product_id=p.id ORDER BY i.position LIMIT 1) AS "imageId",
coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'objectKey',i.object_key,'alt',i.alt) ORDER BY i.position) FROM product_images i WHERE i.product_id=p.id),'[]'::jsonb) AS images,
(${price})::float8 AS price,p.old_price::float8 AS "oldPrice",p.created_at > now()-interval '30 days' AS "isNew",
coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'size',coalesce(v.size,''),'color',coalesce(v.color,''),'available',v.availability,'price',coalesce(v.price_override,p.base_price)::float8) ORDER BY v.id) FROM product_variants v WHERE v.product_id=p.id),'[]'::jsonb) AS variants,
${shopJson} AS "shopDetails"`;
function variantConditions(q: CatalogQueryDto): SQL {
  const v: SQL[] = [sql`v.product_id=p.id`];
  if (q.size) v.push(sql`v.size=${q.size}`);
  if (q.color) v.push(sql`v.color=${q.color}`);
  if (q.availability) v.push(sql`v.availability=true`);
  if (q.priceMin)
    v.push(
      sql`coalesce(v.price_override,p.base_price)>=${q.priceMin}::numeric`,
    );
  if (q.priceMax)
    v.push(
      sql`coalesce(v.price_override,p.base_price)<=${q.priceMax}::numeric`,
    );
  if (q.discount)
    v.push(sql`p.old_price>coalesce(v.price_override,p.base_price)`);

  return sql.join(v, sql` AND `);
}
function matchingPrice(q: CatalogQueryDto): SQL {
  return sql`SELECT min(coalesce(v.price_override,p.base_price)) FROM product_variants v WHERE ${variantConditions(q)}`;
}
function conditions(q: CatalogQueryDto): SQL {
  const parts: SQL[] = [visible];
  if (q.priceMin && q.priceMax && Number(q.priceMin) > Number(q.priceMax))
    throw new BadRequestException('Invalid price range');
  if (q.q) {
    const pattern = '%' + q.q.replace(/[\\%_]/g, '\\$&') + '%';
    parts.push(
      sql`(p.search_vector @@ websearch_to_tsquery('russian',${q.q}) OR p.search_vector @@ websearch_to_tsquery('simple',${q.q}) OR p.search_text %> ${q.q} OR p.search_text ILIKE ${pattern})`,
    );
  }
  if (q.category)
    parts.push(sql`(c.slug=${q.category} OR pc.slug=${q.category})`);
  if (q.subcategory)
    parts.push(sql`c.slug=${q.subcategory} AND c.parent_id IS NOT NULL`);
  if (q.brand) parts.push(sql`b.name=${q.brand}`);
  if (q.shop) parts.push(sql`s.slug=${q.shop}`);
  if (q.mall) parts.push(sql`l.mall=${q.mall}`);
  parts.push(
    sql`EXISTS(SELECT 1 FROM product_variants v WHERE ${variantConditions(q)})`,
  );
  return sql.join(parts, sql` AND `);
}
@Injectable()
export class PublicCatalogService {
  constructor(@Inject(Database) private readonly database: Database) {}
  private seoRows() {
    return sql`SELECT '/product/' || p.slug AS path,p.updated_at FROM products p JOIN shops s ON s.id=p.shop_id
      WHERE p.status='PUBLISHED' AND s.status='ACTIVE' AND ${subscriptionVisible(sql`s.id`)}
      UNION ALL SELECT '/shop/' || s.slug AS path,s.updated_at FROM shops s
      WHERE s.status='ACTIVE' AND ${subscriptionVisible(sql`s.id`)}`;
  }
  async seoCount() {
    const result = await this.database.client.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM (${this.seoRows()}) urls`,
    );
    return { total: result.rows[0]?.total ?? 0 };
  }
  async seoEntries(page: number) {
    const result = await this.database.client.execute(
      sql`SELECT path,updated_at AS "updatedAt" FROM (${this.seoRows()}) urls ORDER BY path LIMIT 1000 OFFSET ${(page - 1) * 1000}`,
    );
    return result.rows;
  }
  async catalog(query: CatalogQueryDto) {
    const where = conditions(query);
    const order =
      query.sort === 'price-asc'
        ? sql`price ASC,p.id`
        : query.sort === 'price-desc'
          ? sql`price DESC,p.id`
          : query.q && !query.sort
            ? sql`ts_rank(p.search_vector,websearch_to_tsquery('russian',${query.q})) DESC,word_similarity(${query.q},p.search_text) DESC,p.id`
            : sql`p.created_at DESC,p.id`;
    return this.database.client.transaction(
      async (tx) => {
        const count = await tx.execute<{ total: number }>(
          sql`SELECT count(*)::int AS total ${joins} WHERE ${where}`,
        );
        const result = await tx.execute(
          sql`SELECT ${projection(matchingPrice(query))} ${joins} WHERE ${where} ORDER BY ${order} LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
        );
        const total = count.rows[0]?.total ?? 0;
        return {
          items: result.rows,
          total,
          page: query.page,
          pages: Math.ceil(total / query.limit),
          limit: query.limit,
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
  async product(slug: string) {
    const result = await this.database.client.execute(
      sql`SELECT ${projection(sql`coalesce((${matchingPrice(new CatalogQueryDto())}),p.base_price)`)} ${joins} WHERE ${visible} AND p.slug=${slug} LIMIT 1`,
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    return row;
  }
  async shop(slug: string) {
    const result = await this.database.client.execute<{ shop: unknown }>(
      sql`SELECT ${shopJson} AS shop FROM shops s LEFT JOIN shop_locations l ON l.shop_id=s.id WHERE s.status='ACTIVE' AND ${subscriptionVisible(sql`s.id`)} AND s.slug=${slug}`,
    );
    if (!result.rows[0]) throw new NotFoundException();
    return result.rows[0].shop;
  }
  async shops(query: CatalogQueryDto) {
    const result = await this.database.client.execute<{ shop: unknown }>(
      sql`SELECT ${shopJson} AS shop FROM shops s LEFT JOIN shop_locations l ON l.shop_id=s.id WHERE s.status='ACTIVE' AND ${subscriptionVisible(sql`s.id`)} ORDER BY s.name,s.id LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
    );
    return result.rows.map((row) => row.shop);
  }
  async categories() {
    return (
      await this.database.client.execute(
        sql`SELECT id,name,slug,parent_id AS "parentId",'' AS note FROM categories ORDER BY name LIMIT 1000`,
      )
    ).rows;
  }
  async brands(query: CatalogQueryDto) {
    return (
      await this.database.client.execute(
        sql`SELECT id,name,slug FROM brands ORDER BY name,id LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      )
    ).rows;
  }
  async facets() {
    const result = await this.database.client.execute(sql`SELECT
 coalesce(array_agg(DISTINCT b.name) FILTER(WHERE b.name IS NOT NULL),'{}') AS brands,
 coalesce(jsonb_agg(DISTINCT jsonb_build_object('slug',s.slug,'name',s.name)),'[]'::jsonb) AS shops,
 coalesce(array_agg(DISTINCT c.slug) FILTER(WHERE c.parent_id IS NOT NULL),'{}') AS subcategories,
 coalesce(array_agg(DISTINCT l.mall) FILTER(WHERE l.mall IS NOT NULL),'{}') AS malls,
 coalesce(array_agg(DISTINCT v.size) FILTER(WHERE v.size IS NOT NULL),'{}') AS sizes,
 coalesce(array_agg(DISTINCT v.color) FILTER(WHERE v.color IS NOT NULL),'{}') AS colors
 ${joins} JOIN product_variants v ON v.product_id=p.id WHERE ${visible}`);
    return result.rows[0];
  }
  async suggestions(q: string) {
    const query = new CatalogQueryDto();
    query.q = q;
    query.limit = 8;
    const result = await this.catalog(query);
    return result.items.map((row) => ({ slug: row.slug, name: row.name }));
  }
}
