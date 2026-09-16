import { Module, type DynamicModule } from '@nestjs/common';
import { SellerOperationsService } from './catalogue/operations.service.js';
import { SellerOperationsController } from './catalogue/operations.controller.js';
import { AdminEnrollment } from './admin/enrollment.js';
import { AdminControl } from './admin/control.js';
import { AdminControlController } from './admin/control.controller.js';
import {
  PublicAnalyticsController,
  SellerAnalyticsController,
} from './analytics/controller.js';
import { AnalyticsService } from './analytics/service.js';
import { APP_CONFIG, type AppConfig } from './config.js';
import { Database } from './database.js';
import { HealthController } from './health.controller.js';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth/controller.js';
import { AuthService } from './auth/service.js';
import { Passwords } from './auth/passwords.js';
import { PasswordResetService } from './auth/password-reset.js';
import {
  PasswordResetDelivery,
  UnconfiguredPasswordResetDelivery,
} from './auth/delivery.js';
import { AuthRateLimiter } from './auth/rate-limiter.js';
import {
  AuthThrottleGuard,
  RequestSecurityGuard,
  SessionGuard,
} from './auth/guards.js';
import { ShopsController } from './shops/controller.js';
import { ShopsService } from './shops/service.js';
import { ShopAuthorization } from './authorization/shop-authorization.js';
import { SellerCatalogController } from './catalogue/seller.controller.js';
import { SellerCatalogService } from './catalogue/seller.service.js';
import { PublicCatalogController } from './catalogue/public.controller.js';
import { PublicCatalogService } from './catalogue/public.service.js';
import {
  MediaController,
  ShopMediaController,
  ShopImageAccessGuard,
  PublicMediaController,
  ImageAccessGuard,
  ImageCapacityInterceptor,
} from './media/controller.js';
import { MediaService } from './media/service.js';
import { MediaMaintenance } from './media/maintenance.js';
import {
  PublicRequestsController,
  SellerRequestsController,
} from './requests/controller.js';
import { CustomerRequestsService } from './requests/service.js';
import {
  CaptchaVerifier,
  ConfiguredCaptchaPolicy,
  RequestFingerprint,
  RequestSpamGuard,
} from './requests/spam.js';
import { ObjectStorage, S3ObjectStorage } from './media/storage.js';
import {
  AdminController,
  AdminLoginController,
  SellerVerificationController,
} from './admin/controller.js';
import { AdminGuard, AdminLoginThrottle } from './admin/guards.js';
import { AdminAuth } from './admin/auth.js';
import { AuditLog } from './admin/audit.js';
import { AdminSecondFactor, TotpSecondFactor } from './admin/security.js';
import { ModerationService } from './admin/moderation.js';
import { SubscriptionService, BillingClock } from './subscriptions/service.js';
import { SubscriptionController } from './subscriptions/controller.js';
import { PaymentProvider } from './subscriptions/provider.js';
import { createPaymentProvider } from './subscriptions/provider-factory.js';
import { PaymentInvoiceBindings } from './subscriptions/invoice-bindings.js';

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        ShopMediaController,
        AdminControlController,
        SellerOperationsController,
        PublicAnalyticsController,
        SellerAnalyticsController,
        SubscriptionController,
        AdminController,
        AdminLoginController,
        SellerVerificationController,
        PublicRequestsController,
        SellerRequestsController,
        MediaController,
        PublicMediaController,
        HealthController,
        AuthController,
        ShopsController,
        SellerCatalogController,
        PublicCatalogController,
      ],
      providers: [
        ShopImageAccessGuard,
        AdminControl,
        AdminEnrollment,
        SellerOperationsService,
        AnalyticsService,
        SubscriptionService,
        PaymentInvoiceBindings,
        BillingClock,
        {
          provide: PaymentProvider,
          useFactory: () =>
            createPaymentProvider({
              ...process.env,
              NODE_ENV: config.environment,
            }),
        },
        AdminAuth,
        AuditLog,
        AdminLoginThrottle,
        ModerationService,
        { provide: AdminSecondFactor, useClass: TotpSecondFactor },
        CustomerRequestsService,
        RequestFingerprint,
        RequestSpamGuard,
        { provide: CaptchaVerifier, useClass: ConfiguredCaptchaPolicy },
        MediaService,
        MediaMaintenance,
        ImageAccessGuard,
        ImageCapacityInterceptor,
        { provide: ObjectStorage, useClass: S3ObjectStorage },
        { provide: APP_CONFIG, useValue: config },
        Database,
        Passwords,
        AuthService,
        PasswordResetService,
        AuthRateLimiter,
        ShopsService,
        ShopAuthorization,
        SellerCatalogService,
        PublicCatalogService,
        {
          provide: PasswordResetDelivery,
          useClass: UnconfiguredPasswordResetDelivery,
        },
        { provide: APP_GUARD, useClass: RequestSecurityGuard },
        { provide: APP_GUARD, useClass: AuthThrottleGuard },
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_GUARD, useClass: AdminGuard },
      ],
      exports: [Database],
    };
  }
}
