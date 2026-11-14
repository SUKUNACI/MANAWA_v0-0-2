class FinanceModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * GET /api/finances — List transactions with filters and pagination
   */
  async getTransactions(page = 1, limit = 50, filters = {}) {
    const { status, startDate, endDate } = filters;

    // Build where clause
    const where = {};
    if (status) where.status = status;
    if (startDate) where.createdAt = { ...where.createdAt, gte: new Date(startDate) };
    if (endDate) where.createdAt = { ...where.createdAt, lte: new Date(endDate) };

    // Calculate skip
    const skip = (page - 1) * limit;

    // Fetch transactions
    const transactions = await this.prisma.payment.findMany({
      where,
      skip,
      take: limit,
      include: {
        quote: {
          include: {
            professional: {
              include: {
                user: {
                  select: { id: true, email: true, firstName: true, lastName: true },
                },
              },
            },
            project: {
              select: { id: true, title: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get total count
    const total = await this.prisma.payment.count({ where });

    // Get summary aggregate
    const summary = await this.prisma.payment.aggregate({
      where,
      _sum: { amount: true },
      _count: true,
    });

    return {
      transactions,
      summary: {
        totalAmount: summary._sum.amount || 0,
        transactionCount: summary._count,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * GET /api/finances/summary — Get financial summary metrics
   */
  async getSummary() {
    // Execute 4 concurrent aggregations
    const [totalRevenue, monthlyRevenue, pendingPayments, completedPayments] = await Promise.all([
      // Total revenue (all-time COMPLETED)
      this.prisma.payment.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      // Monthly revenue (last 30 days COMPLETED)
      this.prisma.payment.aggregate({
        where: {
          status: 'COMPLETED',
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
        _sum: { amount: true },
      }),
      // Pending payments count
      this.prisma.payment.aggregate({
        where: { status: 'PENDING' },
        _count: true,
      }),
      // Completed payments count
      this.prisma.payment.aggregate({
        where: { status: 'COMPLETED' },
        _count: true,
      }),
    ]);

    return {
      totalRevenue: totalRevenue._sum.amount || 0,
      monthlyRevenue: monthlyRevenue._sum.amount || 0,
      pendingPayments: pendingPayments._count,
      completedPayments: completedPayments._count,
    };
  }
}

module.exports = FinanceModule;
