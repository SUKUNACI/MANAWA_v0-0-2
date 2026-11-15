'use strict';

const logger = require('../utils/logger');

class CompanyModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async list({ search, limit = 20, skip = 0 } = {}) {
    const where = { accountType: 'ENTREPRISE' };

    if (search) {
      where.OR = [
        { trade: { contains: search, mode: 'insensitive' } },
        { user: { firstName: { contains: search, mode: 'insensitive' } } },
        { user: { lastName: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [companies, total] = await Promise.all([
      this.prisma.professional.findMany({
        where,
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
        skip: Math.max(0, skip),
        take: Math.min(100, limit),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.professional.count({ where }),
    ]);

    return { companies, total };
  }

  async getProfile(companyId) {
    const company = await this.prisma.professional.findUnique({
      where: { id: companyId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        reviews: { take: 5, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!company) throw Object.assign(new Error('Entreprise introuvable'), { status: 404, code: 'COMPANY_NOT_FOUND' });
    return company;
  }

  async updateProfile(companyId, data) {
    const company = await this.prisma.professional.findUnique({
      where: { id: companyId },
      include: { user: { select: { id: true } } },
    });

    if (!company) throw Object.assign(new Error('Entreprise introuvable'), { status: 404, code: 'COMPANY_NOT_FOUND' });

    const allowedFields = ['bio', 'website', 'phone', 'address', 'city', 'postalCode', 'country', 'trade'];
    const patch = Object.fromEntries(
      Object.entries(data).filter(([key]) => allowedFields.includes(key))
    );

    if (Object.keys(patch).length === 0) {
      return company;
    }

    const updated = await this.prisma.professional.update({
      where: { id: companyId },
      data: patch,
    });

    logger.info('[CompanyModule] Profile updated', { companyId });
    return updated;
  }
}

module.exports = CompanyModule;
