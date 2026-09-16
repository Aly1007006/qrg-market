import { sql } from 'drizzle-orm';
import {
  check,
  boolean,
  numeric,
  customType,
  foreignKey,
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  bigint,
  pgEnum,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const shopStatus = pgEnum('shop_status', [
  'DRAFT',
  'PENDING_VERIFICATION',
  'CHANGES_REQUESTED',
  'VERIFIED',
  'ACTIVE',
  'SUSPENDED',
  'REJECTED',
]);
export const shopRole = pgEnum('shop_role', [
  'SHOP_OWNER',
  'SHOP_MANAGER',
  'SHOP_EMPLOYEE',
]);
export type ShopRole = (typeof shopRole.enumValues)[number];
export const subscriptionStatus = pgEnum('subscription_status', [
  'ACTIVE',
  'PAST_DUE',
  'GRACE',
  'SUSPENDED',
  'CANCELLED',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(t.email),
    check(
      'users_email_normalized',
      sql`${t.email} = lower(btrim(${t.email})) AND length(${t.email}) BETWEEN 3 AND 254`,
    ),
    check('users_password_argon2id', sql`${t.passwordHash} LIKE '$argon2id$%'`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    rotatedAt: timestamp('rotated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_unique').on(t.tokenHash),
    index('sessions_user_active_idx')
      .on(t.userId, t.expiresAt)
      .where(sql`${t.revokedAt} IS NULL`),
    index('sessions_expiry_idx').on(t.expiresAt),
    check('sessions_hash_format', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('sessions_expiry_valid', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

export const shops = pgTable(
  'shops',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug')
      .notNull()
      .default(sql`'shop-' || gen_random_uuid()::text`),
    description: text('description').notNull().default(''),
    status: shopStatus('status').default('DRAFT').notNull(),
    ...timestamps(),
  },
  (t) => [
    index('shops_status_idx').on(t.status),
    uniqueIndex('shops_slug_unique').on(t.slug),
    check(
      'shops_slug_format',
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(${t.slug}) <= 120`,
    ),
    check(
      'shops_name_valid',
      sql`${t.name} = btrim(${t.name}) AND length(${t.name}) BETWEEN 1 AND 120`,
    ),
  ],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'restrict' }),
    plan: text('plan').notNull().default('QRG_BUSINESS'),
    amountMinor: integer('amount_minor').notNull().default(1000000),
    currency: text('currency').notNull().default('KZT'),
    status: subscriptionStatus('status').notNull().default('SUSPENDED'),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    anchorDay: integer('anchor_day'),
    autoRenew: boolean('auto_renew').notNull().default(false),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    nextPaymentAt: timestamp('next_payment_at', { withTimezone: true }),
    graceEndsAt: timestamp('grace_ends_at', { withTimezone: true }),
    cycle: integer('cycle').notNull().default(0),
    version: integer('version').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('subscriptions_shop_unique').on(t.shopId),
    index('subscriptions_due_idx').on(t.status, t.nextPaymentAt),
    index('subscriptions_grace_idx').on(t.graceEndsAt),
    check(
      'subscription_fixed_plan',
      sql`${t.plan}='QRG_BUSINESS' AND ${t.amountMinor}=1000000 AND ${t.currency}='KZT'`,
    ),
    check(
      'subscription_period_valid',
      sql`(${t.periodStart} IS NULL AND ${t.periodEnd} IS NULL AND ${t.anchorDay} IS NULL) OR (${t.periodStart} IS NOT NULL AND ${t.periodEnd} IS NOT NULL AND ${t.anchorDay} IS NOT NULL AND ${t.periodEnd} > ${t.periodStart} AND ${t.anchorDay} BETWEEN 1 AND 31)`,
    ),
    check(
      'subscription_paid_status_period',
      sql`${t.status} NOT IN ('ACTIVE','PAST_DUE','GRACE') OR (${t.periodStart} IS NOT NULL AND ${t.periodEnd} IS NOT NULL)`,
    ),
    check(
      'subscription_state_dates',
      sql`(${t.status}<>'GRACE' OR ${t.graceEndsAt} IS NOT NULL) AND (${t.status}<>'PAST_DUE' OR ${t.nextPaymentAt} IS NOT NULL) AND (NOT ${t.cancelAtPeriodEnd} OR NOT ${t.autoRenew})`,
    ),
    check(
      'subscription_revision_valid',
      sql`${t.cycle}>=0 AND ${t.version}>=0`,
    ),
  ],
);
export const paymentAttempts = pgTable(
  'payment_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'restrict' }),
    idempotencyKey: uuid('idempotency_key').notNull(),
    cycle: integer('cycle').notNull(),
    kind: text('kind').$type<'INITIAL' | 'RENEWAL' | 'RETRY'>().notNull(),
    status: text('status')
      .$type<'PENDING' | 'SUCCEEDED' | 'FAILED'>()
      .notNull()
      .default('PENDING'),
    amountMinor: integer('amount_minor').notNull().default(1000000),
    currency: text('currency').notNull().default('KZT'),
    provider: text('provider'),
    providerPaymentId: text('provider_payment_id'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('attempt_idempotency_unique').on(t.idempotencyKey),
    uniqueIndex('attempt_pending_cycle_unique')
      .on(t.subscriptionId, t.cycle)
      .where(sql`${t.status}='PENDING'`),
    uniqueIndex('attempt_provider_payment_unique').on(t.providerPaymentId),
    uniqueIndex('attempt_association_unique').on(t.id, t.subscriptionId),
    index('attempt_history_idx').on(t.subscriptionId, t.createdAt, t.id),
    check(
      'attempt_fixed_amount',
      sql`${t.amountMinor}=1000000 AND ${t.currency}='KZT' AND ${t.cycle}>=0`,
    ),
    check(
      'attempt_kind_valid',
      sql`${t.kind} IN ('INITIAL','RENEWAL','RETRY')`,
    ),
    check(
      'attempt_outcome_valid',
      sql`(${t.status}='PENDING' AND ${t.completedAt} IS NULL AND ${t.provider} IS NULL AND ${t.providerPaymentId} IS NULL) OR (${t.status} IN ('SUCCEEDED','FAILED') AND ${t.completedAt} IS NOT NULL AND ${t.provider} IS NOT NULL AND ${t.providerPaymentId} IS NOT NULL)`,
    ),
  ],
);
// A six-digit invoice satisfies Halyk's full-ID AND last-six uniqueness rule.
// No wraparound/recycling, including after aborted transactions or deleted fixtures.
export const halykInvoiceSequence = pgSequence('halyk_invoice_sequence', {
  startWith: 100000,
  minValue: 100000,
  maxValue: 999999,
  increment: 1,
  cycle: false,
  cache: 1,
});
export const paymentProviderBindings = pgTable(
  'payment_provider_bindings',
  {
    attemptId: uuid('attempt_id').primaryKey(),
    subscriptionId: uuid('subscription_id').notNull(),
    provider: text('provider').$type<'halyk'>().notNull(),
    environment: text('environment')
      .$type<'sandbox' | 'production'>()
      .notNull(),
    merchantId: uuid('merchant_id').notNull(),
    invoiceId: text('invoice_id')
      .notNull()
      .default(sql`nextval('halyk_invoice_sequence')::text`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.attemptId, t.subscriptionId],
      foreignColumns: [paymentAttempts.id, paymentAttempts.subscriptionId],
    }).onDelete('restrict'),
    uniqueIndex('provider_binding_invoice_unique').on(
      t.provider,
      t.environment,
      t.merchantId,
      t.invoiceId,
    ),
    index('provider_binding_subscription_idx').on(t.subscriptionId),
    check('provider_binding_provider_valid', sql`${t.provider} = 'halyk'`),
    check(
      'provider_binding_environment_valid',
      sql`${t.environment} IN ('sandbox','production')`,
    ),
    check(
      'provider_binding_invoice_valid',
      sql`${t.invoiceId} ~ '^[1-9][0-9]{5}$'`,
    ),
  ],
);

export const subscriptionPayments = pgTable(
  'subscription_payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'restrict' }),
    attemptId: uuid('attempt_id').notNull(),
    provider: text('provider').notNull(),
    providerPaymentId: text('provider_payment_id').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex('subscription_payment_provider_unique').on(t.providerPaymentId),
    uniqueIndex('subscription_payment_attempt_unique').on(t.attemptId),
    foreignKey({
      columns: [t.attemptId, t.subscriptionId],
      foreignColumns: [paymentAttempts.id, paymentAttempts.subscriptionId],
    }),
    index('subscription_payment_history_idx').on(t.subscriptionId, t.createdAt),
    check(
      'subscription_payment_values',
      sql`${t.amountMinor}=1000000 AND ${t.currency}='KZT' AND ${t.periodEnd}>${t.periodStart}`,
    ),
  ],
);

export const shopMembers = pgTable(
  'shop_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: shopRole('role').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('shop_members_shop_user_unique').on(t.shopId, t.userId),
    uniqueIndex('shop_members_one_owner')
      .on(t.shopId)
      .where(sql`${t.role} = 'SHOP_OWNER'`),
    index('shop_members_user_idx').on(t.userId, t.shopId),
  ],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('password_reset_token_hash_unique').on(t.tokenHash),
    index('password_reset_user_idx').on(t.userId),
    index('password_reset_expiry_idx').on(t.expiresAt),
    check('password_reset_hash_format', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('password_reset_expiry_valid', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

export const authRateLimits = pgTable(
  'auth_rate_limits',
  {
    keyHash: text('key_hash').primaryKey(),
    hits: integer('hits').notNull(),
    windowEndsAt: timestamp('window_ends_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('auth_rate_limits_expiry_idx').on(t.windowEndsAt),
    check('auth_rate_limits_hits_positive', sql`${t.hits} > 0`),
    check('auth_rate_limits_key_format', sql`${t.keyHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const adminAccounts = pgTable(
  'admin_accounts',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('ADMIN'),
    enabled: boolean('enabled').notNull().default(true),
    mustChangePassword: boolean('must_change_password')
      .notNull()
      .default(false),
    totpEncrypted: text('totp_encrypted'),
    pendingTotpEncrypted: text('pending_totp_encrypted'),
    recoveryHashes: jsonb('recovery_hashes')
      .$type<string[]>()
      .notNull()
      .default([]),
    lastTotpStep: bigint('last_totp_step', { mode: 'number' })
      .notNull()
      .default(-1),
    canModerate: boolean('can_moderate').notNull().default(false),
    canSuspend: boolean('can_suspend').notNull().default(false),
    canReadAudit: boolean('can_read_audit').notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    check(
      'admin_role_only',
      sql`${t.role} IN ('ADMIN', 'SUPER_ADMIN', 'MODERATION_ADMIN', 'SUPPORT_ADMIN', 'FINANCE_ADMIN')`,
    ),
    check(
      'admin_totp_encrypted',
      sql`${t.totpEncrypted} IS NULL OR ${t.totpEncrypted} ~ '^v1[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$'`,
    ),
    check('admin_totp_step_valid', sql`${t.lastTotpStep} >= -1`),
  ],
);

export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => adminAccounts.userId, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    mfaVerifiedAt: timestamp('mfa_verified_at', {
      withTimezone: true,
    }).defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('admin_sessions_hash_unique').on(t.tokenHash),
    index('admin_sessions_user_idx').on(t.userId, t.expiresAt),
    index('admin_sessions_expiry_idx').on(t.expiresAt),
    check('admin_sessions_hash_valid', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'admin_sessions_lifetime',
      sql`${t.expiresAt} > ${t.createdAt} AND ${t.expiresAt} <= ${t.createdAt} + interval '1 hour'`,
    ),
  ],
);

// Immutable event references deliberately survive deletion of live resources/users.
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    resource: text('resource').notNull(),
    resourceId: uuid('resource_id'),
    result: text('result').notNull(),
    reason: text('reason'),
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('audit_created_idx').on(t.createdAt, t.id),
    index('audit_resource_idx').on(t.resourceId, t.createdAt),
    check(
      'audit_fields_bounded',
      sql`length(${t.actor}) BETWEEN 1 AND 160 AND length(${t.action}) BETWEEN 1 AND 80 AND length(${t.resource}) BETWEEN 1 AND 80`,
    ),
    check(
      'audit_result_valid',
      sql`${t.result} IN ('SUCCESS','DENIED','FAILED')`,
    ),
  ],
);

export const moderationCases = pgTable(
  'moderation_cases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    submittedBy: uuid('submitted_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    index('moderation_shop_idx').on(t.shopId, t.createdAt),
    uniqueIndex('moderation_one_open_case')
      .on(t.shopId)
      .where(sql`${t.closedAt} IS NULL`),
  ],
);

export const moderationHistory = pgTable(
  'moderation_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    shopId: uuid('shop_id').notNull(),
    caseId: uuid('case_id'),
    actorId: uuid('actor_id').notNull(),
    action: text('action').notNull(),
    fromStatus: shopStatus('from_status').notNull(),
    toStatus: shopStatus('to_status').notNull(),
    reason: text('reason').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('moderation_history_shop_idx').on(t.shopId, t.createdAt, t.id),
    check(
      'moderation_action_valid',
      sql`${t.action} IN ('SUBMIT','APPROVE','REQUEST_CHANGES','REJECT','SUSPEND','RESTORE')`,
    ),
    check(
      'moderation_reason_valid',
      sql`length(${t.reason}) <= 2000 AND (${t.action} NOT IN ('REQUEST_CHANGES','REJECT','SUSPEND') OR length(btrim(${t.reason})) > 0)`,
    ),
  ],
);

const vector = customType<{ data: string }>({ dataType: () => 'tsvector' });
// No visitor identity, IP, URL, user agent, consent payload or arbitrary metadata.
export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id').notNull(),
    type: text('type').notNull(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    productId: uuid('product_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('analytics_event_replay_unique').on(t.type, t.eventId),
    foreignKey({
      columns: [t.productId, t.shopId],
      foreignColumns: [products.id, products.shopId],
    }).onDelete('cascade'),
    index('analytics_shop_time_idx').on(t.shopId, t.createdAt, t.type),
    index('analytics_product_time_idx').on(t.productId, t.createdAt),
    index('analytics_retention_idx').on(t.createdAt),
    check(
      'analytics_type_valid',
      sql`${t.type} IN ('SHOP_VIEW','PRODUCT_VIEW','WHATSAPP_CLICK','TWO_GIS_CLICK','CUSTOMER_REQUEST_CREATED')`,
    ),
    check(
      'analytics_resource_valid',
      sql`(${t.type}<>'SHOP_VIEW' OR ${t.productId} IS NULL) AND (${t.type} NOT IN ('PRODUCT_VIEW','CUSTOMER_REQUEST_CREATED') OR ${t.productId} IS NOT NULL)`,
    ),
  ],
);
// Durable upload/deletion intents survive product/shop deletion and process crashes.
export const mediaObjects = pgTable(
  'media_objects',
  {
    objectKey: text('object_key').primaryKey(),
    productId: uuid('product_id').references(() => products.id, {
      onDelete: 'set null',
    }),
    shopId: uuid('shop_id').references(() => shops.id, {
      onDelete: 'set null',
    }),
    state: text('state').notNull().default('PENDING'),
    retryAt: timestamp('retry_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('media_cleanup_idx').on(t.state, t.retryAt),
    index('media_product_idx').on(t.productId),
    check(
      'media_state_valid',
      sql`${t.state} IN ('PENDING','ATTACHED','DELETING')`,
    ),
    check(
      'media_key_valid',
      sql`${t.objectKey} ~ '^(products|shops)/[0-9a-f-]{36}/[0-9a-f-]{36}[.](webp|avif)$'`,
    ),
  ],
);
const point = customType<{ data: string }>({
  dataType: () => 'geometry(Point,4326)',
});
export const productStatus = pgEnum('product_status', [
  'DRAFT',
  'PUBLISHED',
  'ARCHIVED',
]);
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, {
      onDelete: 'restrict',
    }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('categories_slug_unique').on(t.slug),
    index('categories_parent_idx').on(t.parentId),
    check(
      'categories_name_valid',
      sql`length(btrim(${t.name})) BETWEEN 1 AND 100`,
    ),
    check(
      'categories_slug_valid',
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(${t.slug}) <= 100`,
    ),
    check(
      'categories_not_self',
      sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`,
    ),
  ],
);
export const brands = pgTable(
  'brands',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('brands_slug_unique').on(t.slug),
    uniqueIndex('brands_name_unique').on(sql`lower(${t.name})`),
    check('brands_name_valid', sql`length(btrim(${t.name})) BETWEEN 1 AND 100`),
    check(
      'brands_slug_valid',
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(${t.slug}) <= 100`,
    ),
  ],
);
export const products = pgTable(
  'products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    brandId: uuid('brand_id').references(() => brands.id, {
      onDelete: 'restrict',
    }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull().default(''),
    basePrice: numeric('base_price', {
      precision: 12,
      scale: 2,
      mode: 'number',
    }).notNull(),
    oldPrice: numeric('old_price', { precision: 12, scale: 2, mode: 'number' }),
    status: productStatus('status').notNull().default('DRAFT'),
    moderationHidden: boolean('moderation_hidden').notNull().default(false),
    moderationPreviousStatus: productStatus('moderation_previous_status'),
    searchText: text('search_text').notNull().default(''),
    searchVector: vector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('russian', search_text) || to_tsvector('simple', search_text)`,
    ),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('products_slug_unique').on(t.slug),
    check(
      'products_moderation_visibility',
      sql`NOT ${t.moderationHidden} OR ${t.status} <> 'PUBLISHED'`,
    ),
    uniqueIndex('products_id_shop_unique').on(t.id, t.shopId),
    index('products_shop_idx').on(t.shopId, t.createdAt),
    index('products_category_idx').on(t.categoryId),
    index('products_brand_idx').on(t.brandId),
    index('products_public_price_idx')
      .on(t.basePrice, t.id)
      .where(sql`${t.status} = 'PUBLISHED'`),
    index('products_public_new_idx')
      .on(t.createdAt, t.id)
      .where(sql`${t.status} = 'PUBLISHED'`),
    index('products_fts_idx').using('gin', t.searchVector),
    index('products_trgm_idx').using('gin', sql`${t.searchText} gin_trgm_ops`),
    check(
      'products_name_valid',
      sql`length(btrim(${t.name})) BETWEEN 1 AND 200`,
    ),
    check('products_description_limit', sql`length(${t.description}) <= 10000`),
    check(
      'products_slug_valid',
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(${t.slug}) <= 120`,
    ),
    check(
      'products_price_valid',
      sql`${t.basePrice} BETWEEN 0 AND 99999999.99 AND (${t.oldPrice} IS NULL OR (${t.oldPrice} > ${t.basePrice} AND ${t.oldPrice} <= 99999999.99))`,
    ),
  ],
);
// Incomplete editor state cannot enter the public product catalogue.
export const productDrafts = pgTable(
  'product_drafts',
  {
    id: uuid('id').primaryKey(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id, {
      onDelete: 'restrict',
    }),
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),
    version: integer('version').notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    index('product_drafts_owner_idx').on(t.shopId, t.userId, t.updatedAt),
    check('product_drafts_version_valid', sql`${t.version} > 0`),
    check(
      'product_drafts_content_object',
      sql`jsonb_typeof(${t.content}) = 'object' AND octet_length(${t.content}::text) <= 40000`,
    ),
  ],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    size: text('size'),
    color: text('color'),
    sku: text('sku'),
    priceOverride: numeric('price_override', {
      precision: 12,
      scale: 2,
      mode: 'number',
    }),
    available: boolean('availability').notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      columns: [t.productId, t.shopId],
      foreignColumns: [products.id, products.shopId],
    }).onDelete('cascade'),
    index('variants_product_idx').on(t.productId),
    uniqueIndex('variants_id_product_shop_unique').on(
      t.id,
      t.productId,
      t.shopId,
    ),
    uniqueIndex('variants_shop_sku_unique')
      .on(t.shopId, t.sku)
      .where(sql`${t.sku} IS NOT NULL`),
    uniqueIndex('variants_options_unique').on(
      t.productId,
      sql`coalesce(${t.size},'')`,
      sql`coalesce(${t.color},'')`,
    ),
    index('variants_filters_idx').on(t.size, t.color, t.available, t.productId),
    check(
      'variants_price_valid',
      sql`${t.priceOverride} IS NULL OR ${t.priceOverride} BETWEEN 0 AND 99999999.99`,
    ),
    check(
      'variants_text_valid',
      sql`(${t.size} IS NULL OR length(btrim(${t.size})) BETWEEN 1 AND 40) AND (${t.color} IS NULL OR length(btrim(${t.color})) BETWEEN 1 AND 40) AND (${t.sku} IS NULL OR length(btrim(${t.sku})) BETWEEN 1 AND 100)`,
    ),
  ],
);
export const productImages = pgTable(
  'product_images',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    objectKey: text('object_key').notNull(),
    alt: text('alt').notNull().default(''),
    position: integer('position').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('images_object_key_unique').on(t.objectKey),
    uniqueIndex('images_product_position_unique').on(t.productId, t.position),
    check('images_position_limit', sql`${t.position} BETWEEN 0 AND 9`),
    check(
      'images_dimensions_valid',
      sql`${t.width} BETWEEN 1 AND 12000 AND ${t.height} BETWEEN 1 AND 12000`,
    ),
    check('images_alt_limit', sql`length(${t.alt}) <= 300`),
    check(
      'images_key_valid',
      sql`${t.objectKey} ~ '^products/[0-9a-f-]{36}/[0-9a-f-]{36}[.](webp|avif)$' AND split_part(${t.objectKey},'/',2) = ${t.productId}::text`,
    ),
  ],
);
export const shopLocations = pgTable(
  'shop_locations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    city: text('city').notNull().default('Караганда'),
    address: text('address').notNull(),
    mall: text('mall'),
    twoGisUrl: text('two_gis_url'),
    twoGisFirmId: text('two_gis_firm_id'),
    latitude: numeric('latitude', { precision: 10, scale: 7, mode: 'number' }),
    longitude: numeric('longitude', {
      precision: 10,
      scale: 7,
      mode: 'number',
    }),
    geo: point('geo').generatedAlwaysAs(
      sql`CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision),4326) ELSE NULL END`,
    ),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('locations_shop_unique').on(t.shopId),
    index('locations_mall_idx').on(t.mall),
    index('locations_geo_idx').using('gist', t.geo),
    check(
      'locations_address_valid',
      sql`length(btrim(${t.address})) BETWEEN 1 AND 300 AND length(${t.city}) BETWEEN 1 AND 100 AND (${t.mall} IS NULL OR length(btrim(${t.mall})) BETWEEN 1 AND 150)`,
    ),
    check(
      'locations_coordinates_valid',
      sql`(${t.latitude} IS NULL AND ${t.longitude} IS NULL) OR (${t.latitude} IS NOT NULL AND ${t.longitude} IS NOT NULL AND ${t.latitude} BETWEEN -90 AND 90 AND ${t.longitude} BETWEEN -180 AND 180)`,
    ),
    check(
      'locations_2gis_valid',
      sql`(${t.twoGisUrl} IS NULL AND ${t.twoGisFirmId} IS NULL) OR (${t.twoGisUrl} IS NOT NULL AND ${t.twoGisFirmId} IS NOT NULL AND ${t.twoGisUrl} ~ '^https://2gis[.]kz/karaganda/firm/[0-9]{10,20}$' AND ${t.twoGisUrl} = 'https://2gis.kz/karaganda/firm/' || ${t.twoGisFirmId})`,
    ),
  ],
);
export const shopImages = pgTable(
  'shop_images',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'logo' | 'cover'>().notNull(),
    objectKey: text('object_key').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('shop_images_kind_unique').on(t.shopId, t.kind),
    uniqueIndex('shop_images_key_unique').on(t.objectKey),
    check('shop_images_kind_valid', sql`${t.kind} IN ('logo','cover')`),
    check(
      'shop_images_dimensions_valid',
      sql`${t.width} BETWEEN 1 AND 12000 AND ${t.height} BETWEEN 1 AND 12000`,
    ),
    check(
      'shop_images_key_valid',
      sql`${t.objectKey} ~ '^shops/[0-9a-f-]{36}/[0-9a-f-]{36}[.]webp$' AND split_part(${t.objectKey},'/',2)=${t.shopId}::text`,
    ),
  ],
);
export const sellerOnboarding = pgTable(
  'seller_onboarding',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    skipped: boolean('skipped').notNull().default(false),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('seller_onboarding_subject_unique').on(t.shopId, t.userId),
  ],
);

export const shopContacts = pgTable(
  'shop_contacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    phone: text('phone'),
    whatsappPhone: text('whatsapp_phone'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('contacts_shop_unique').on(t.shopId),
    check(
      'contacts_phone_valid',
      sql`(${t.phone} IS NULL OR ${t.phone} ~ '^[+][1-9][0-9]{7,14}$') AND (${t.whatsappPhone} IS NULL OR ${t.whatsappPhone} ~ '^[+][1-9][0-9]{7,14}$')`,
    ),
  ],
);

export const customerRequestStatus = pgEnum('customer_request_status', [
  'NEW',
  'VIEWED',
  'CONTACTED',
  'CONFIRMED',
  'CLOSED',
  'REJECTED',
]);
export const customerRequests = pgTable(
  'customer_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'restrict' }),
    productId: uuid('product_id').notNull(),
    variantId: uuid('variant_id'),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    productName: text('product_name').notNull(),
    variantLabel: text('variant_label').notNull().default(''),
    quantity: integer('quantity').notNull(),
    pickupPreference: text('pickup_preference'),
    comment: text('comment'),
    consentType: text('consent_type').notNull().default('PRIVACY'),
    consentVersion: text('consent_version').notNull(),
    consentAt: timestamp('consent_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: customerRequestStatus('status').notNull().default('NEW'),
    submissionHash: text('submission_hash').notNull(),
    dedupHash: text('dedup_hash').notNull(),
    statusChangedBy: uuid('status_changed_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      columns: [t.productId, t.shopId],
      foreignColumns: [products.id, products.shopId],
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.variantId, t.productId, t.shopId],
      foreignColumns: [
        productVariants.id,
        productVariants.productId,
        productVariants.shopId,
      ],
    }).onDelete('restrict'),
    index('requests_shop_created_idx').on(t.shopId, t.createdAt, t.id),
    index('requests_shop_status_idx').on(t.shopId, t.status, t.createdAt),
    index('requests_product_idx').on(t.productId),
    index('requests_variant_idx').on(t.variantId),
    index('requests_actor_idx').on(t.statusChangedBy),
    index('requests_dedup_idx').on(t.dedupHash, t.createdAt),
    uniqueIndex('requests_submission_unique').on(t.submissionHash),
    check(
      'requests_name_valid',
      sql`length(btrim(${t.name})) BETWEEN 1 AND 100`,
    ),
    check('requests_phone_valid', sql`${t.phone} ~ '^[+][1-9][0-9]{7,14}$'`),
    check('requests_quantity_valid', sql`${t.quantity} BETWEEN 1 AND 99`),
    check(
      'requests_text_limits',
      sql`length(${t.productName}) BETWEEN 1 AND 200 AND length(${t.variantLabel}) <= 200 AND (${t.comment} IS NULL OR length(${t.comment}) <= 1000)`,
    ),
    check(
      'requests_pickup_valid',
      sql`${t.pickupPreference} IS NULL OR ${t.pickupPreference} IN ('SHOP_PICKUP','DISCUSS_WITH_SELLER')`,
    ),
    check(
      'requests_consent_valid',
      sql`${t.consentType} = 'PRIVACY' AND length(${t.consentVersion}) BETWEEN 1 AND 100`,
    ),
    check(
      'requests_hashes_valid',
      sql`${t.submissionHash} ~ '^[0-9a-f]{64}$' AND ${t.dedupHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
