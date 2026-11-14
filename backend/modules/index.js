'use strict';

/**
 * Domain Modules Index
 * Central export point for all domain modules
 */

const SearchModule = require('./search');
const NotificationsModule = require('./notifications');
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

/**
 * Create module instances with Prisma dependency injection
 * @param {object} prisma - Prisma client instance
 * @param {object} stripe - Optional Stripe client
 * @returns {object} All module instances
 */
function createModules(prisma, stripe = null) {
  return {
    search: new SearchModule(prisma),
    notifications: new NotificationsModule(prisma),
    booking: new BookingModule(prisma),
    analytics: new AnalyticsModule(prisma),
    payments: new PaymentsModule(prisma, stripe),
    admin: new AdminModule(prisma),
    auth: new AuthModule(prisma),
    twoFactor: new TwoFactorModule(prisma),
    professional: new ProfessionalModule(prisma),
    project: new ProjectModule(prisma),
    quote: new QuoteModule(prisma),
    message: new MessageModule(prisma),
  };
}

module.exports = {
  SearchModule,
  NotificationsModule,
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
  createModules,
};
