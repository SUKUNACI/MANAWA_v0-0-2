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
  };
}

module.exports = {
  SearchModule,
  NotificationsModule,
  BookingModule,
  AnalyticsModule,
  PaymentsModule,
  createModules,
};
