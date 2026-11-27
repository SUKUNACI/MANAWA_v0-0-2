'use strict';

/**
 * Domain Modules Index
 * Central export point for all domain modules
 */

const SearchModule = require('./search');
const SearchFacetsModule = require('./search-facets');
const SearchGlobalModule = require('./search-global');
const NotificationsModule = require('./notifications');
const NotificationPreferencesModule = require('./notification-preferences');
const NotificationTemplateModule = require('./notification-template');
const BookingModule = require('./booking');
const AnalyticsModule = require('./analytics');
const PaymentsModule = require('./payments');
const AdminModule = require('./admin');
const AuthModule = require('./auth');
const TwoFactorModule = require('./twoFactor');
const ProfessionalModule = require('./professional');
const ProjectModule = require('./project');
const QuoteModule = require('./quote');
const MessageModule = require('./message');
const UserModule = require('./user');
const VerificationModule = require('./verification');
const FinanceModule = require('./finance');
const SubscriptionModule = require('./subscription');
const PaymentRetryModule = require('./paymentRetry');
const RolePermissionModule = require('./rolePermission');
const PortfolioModule = require('./portfolio');
const DisputeModule = require('./dispute');
const ReviewModule = require('./review');
const SupportModule = require('./support');
const VideoCallModule = require('./videoCall');
const BadgeModule = require('./badge');
const CompanyModule = require('./company');
const ReferralModule = require('./referral');
const MobileModule = require('./mobile');

/**
 * Create module instances with Prisma dependency injection
 * @param {object} prisma - Prisma client instance
 * @returns {object} All module instances
 */
function createModules(prisma) {
  const searchModule = new SearchModule(prisma);
  return {
    search: searchModule,
    searchFacets: new SearchFacetsModule(searchModule, prisma),
    searchGlobal: new SearchGlobalModule(searchModule, prisma),
    notifications: new NotificationsModule(prisma),
    notificationPreferences: new NotificationPreferencesModule(prisma),
    notificationTemplate: new NotificationTemplateModule(prisma),
    booking: new BookingModule(prisma),
    analytics: new AnalyticsModule(prisma),
    payments: new PaymentsModule(prisma),
    admin: new AdminModule(prisma),
    auth: new AuthModule(prisma),
    twoFactor: new TwoFactorModule(prisma),
    professional: new ProfessionalModule(prisma),
    project: new ProjectModule(prisma),
    quote: new QuoteModule(prisma),
    message: new MessageModule(prisma),
    user: new UserModule(prisma),
    verification: new VerificationModule(prisma),
    finance: new FinanceModule(prisma),
    subscription: new SubscriptionModule(prisma),
    paymentRetry: new PaymentRetryModule(prisma),
    rolePermission: new RolePermissionModule(prisma),
    portfolio: new PortfolioModule(prisma),
    dispute: new DisputeModule(prisma),
    review: new ReviewModule(prisma),
    support: new SupportModule(prisma),
    videoCall: new VideoCallModule(prisma),
    badge: new BadgeModule(prisma),
    company: new CompanyModule(prisma),
    referral: new ReferralModule(prisma),
    mobile: new MobileModule(prisma),
  };
}

module.exports = {
  SearchModule,
  SearchFacetsModule,
  SearchGlobalModule,
  NotificationsModule,
  NotificationPreferencesModule,
  NotificationTemplateModule,
  BookingModule,
  AnalyticsModule,
  PaymentsModule,
  AdminModule,
  AuthModule,
  TwoFactorModule,
  ProfessionalModule,
  ProjectModule,
  QuoteModule,
  MessageModule,
  UserModule,
  VerificationModule,
  FinanceModule,
  SubscriptionModule,
  PaymentRetryModule,
  RolePermissionModule,
  PortfolioModule,
  DisputeModule,
  ReviewModule,
  SupportModule,
  VideoCallModule,
  BadgeModule,
  CompanyModule,
  ReferralModule,
  MobileModule,
  createModules,
};
