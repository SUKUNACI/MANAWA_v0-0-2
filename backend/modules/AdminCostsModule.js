/**
 * AdminCostsModule
 * Business logic for infrastructure cost tracking
 */

const logger = require('../utils/logger');

const VALID_SERVICES = ['render', 'supabase', 'redis', 'cloudinary', 'mailjet', 'twilio', 'meilisearch', 'other'];

class AdminCostsModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  // List costs with filters
  async listCosts(filters = {}) {
    const { month, service } = filters;
    const where = {};
    if (month) where.month = month;
    if (service) where.service = service;

    const costs = await this.prisma.infraCost.findMany({
      where,
      orderBy: [{ month: 'desc' }, { service: 'asc' }],
    });

    // Aggregate by month with MoM trend
    const byMonth = {};
    costs.forEach(c => {
      if (!byMonth[c.month]) byMonth[c.month] = { month: c.month, total: 0, budget: 0, services: [] };
      byMonth[c.month].total += c.amountEur;
      byMonth[c.month].budget += c.budgetEur || 0;
      byMonth[c.month].services.push({ service: c.service, amount: c.amountEur, budget: c.budgetEur });
    });

    const months = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
    const trend = months.map((m, i) => ({
      ...m,
      momChange: i === 0 || months[i - 1].total === 0 ? null : parseFloat((((m.total - months[i - 1].total) / months[i - 1].total) * 100).toFixed(2)),
    }));

    return { costs, summary: trend };
  }

  // Create or update cost
  async recordCost(data) {
    const { service, month, amountEur, budgetEur, unit, quantity, notes } = data;
    return this.prisma.infraCost.upsert({
      where: { service_month: { service, month } },
      create: { service, month, amountEur, budgetEur: budgetEur || null, unit: unit || null, quantity: quantity || null, notes: notes || null },
      update: { amountEur, budgetEur: budgetEur || null, unit: unit || null, quantity: quantity || null, notes: notes || null },
    });
  }

  // Generate annual report
  async generateReport(year = null) {
    const targetYear = year || new Date().getFullYear();
    const costs = await this.prisma.infraCost.findMany({
      where: { month: { startsWith: `${targetYear}-` } },
      orderBy: [{ month: 'asc' }, { service: 'asc' }],
    });

    const byService = {};
    costs.forEach(c => {
      if (!byService[c.service]) byService[c.service] = { service: c.service, total: 0, budget: 0, months: [] };
      byService[c.service].total += c.amountEur;
      byService[c.service].budget += c.budgetEur || 0;
      byService[c.service].months.push({ month: c.month, amount: c.amountEur });
    });

    const ytdTotal = costs.reduce((s, c) => s + c.amountEur, 0);
    const ytdBudget = costs.reduce((s, c) => s + (c.budgetEur || 0), 0);

    const unitCosts = costs
      .filter(c => c.quantity && c.quantity > 0)
      .map(c => ({
        service: c.service,
        month: c.month,
        unit: c.unit,
        quantity: c.quantity,
        costPerUnit: parseFloat((c.amountEur / c.quantity).toFixed(6)),
      }));

    return {
      year: targetYear,
      ytd: {
        total: parseFloat(ytdTotal.toFixed(2)),
        budget: parseFloat(ytdBudget.toFixed(2)),
        variance: parseFloat((ytdTotal - ytdBudget).toFixed(2)),
        overBudget: ytdTotal > ytdBudget,
      },
      byService: Object.values(byService),
      unitCosts,
    };
  }

  // Delete cost entry
  async deleteCost(costId) {
    const cost = await this.prisma.infraCost.findUnique({ where: { id: costId } });
    if (!cost) throw new Error('Cost entry not found');
    return this.prisma.infraCost.delete({ where: { id: costId } });
  }

  static getValidServices() { return VALID_SERVICES; }
}

module.exports = AdminCostsModule;
