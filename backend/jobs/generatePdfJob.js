const fs = require('fs');
const path = require('path');
const prisma = require('../config/db');
const logger = require('../utils/logger');
const { generateQuotePdfBuffer } = require('../utils/generateQuotePdf');

/**
 * Generate PDF job processor
 * Generates PDFs for quotes and stores them
 *
 * Job data shape:
 * {
 *   type: 'quote' | 'invoice' | 'booking_confirmation',
 *   quoteId?: string,
 *   invoiceId?: string,
 *   bookingId?: string,
 *   metadata?: object
 * }
 */
async function generatePdfJob(job) {
  const { type, quoteId, invoiceId, bookingId, metadata } = job.data;

  if (!type) {
    throw new Error('Missing required field: type');
  }

  try {
    await job.progress(10);

    logger.debug('[generatePdfJob] Starting PDF generation', {
      jobId: job.id,
      type,
      quoteId,
      metadata,
    });

    let pdfBuffer;
    let fileName;
    let storagePath;

    if (type === 'quote' && quoteId) {
      // Fetch quote details
      const quote = await prisma.quote.findUnique({
        where: { id: quoteId },
        include: {
          professional: {
            include: {
              user: true,
              company: true,
            },
          },
          project: {
            include: {
              client: true,
            },
          },
        },
      });

      if (!quote) {
        throw new Error(`Quote not found: ${quoteId}`);
      }

      await job.progress(30);

      // Generate PDF buffer
      pdfBuffer = await generateQuotePdfBuffer(quote);

      await job.progress(70);

      // Create storage directory if it doesn't exist
      const pdfDir = path.join(process.cwd(), 'public', 'pdfs', 'quotes');
      if (!fs.existsSync(pdfDir)) {
        fs.mkdirSync(pdfDir, { recursive: true });
      }

      fileName = `quote_${quoteId}_${Date.now()}.pdf`;
      storagePath = path.join(pdfDir, fileName);

      // Save PDF to disk
      fs.writeFileSync(storagePath, pdfBuffer);

      await job.progress(85);

      // Update quote record with PDF URL
      const pdfUrl = `/pdfs/quotes/${fileName}`;
      await prisma.quote.update({
        where: { id: quoteId },
        data: {
          pdfUrl,
          pdfGeneratedAt: new Date(),
        },
      });

      logger.info('[generatePdfJob] Quote PDF generated successfully', {
        jobId: job.id,
        quoteId,
        fileName,
        pdfUrl,
        fileSize: pdfBuffer.length,
      });
    } else if (type === 'invoice' && invoiceId) {
      logger.info('[generatePdfJob] Invoice PDF generation not yet implemented', {
        jobId: job.id,
        invoiceId,
      });
      // TODO: Implement invoice PDF generation
      throw new Error('Invoice PDF generation not yet implemented');
    } else if (type === 'booking_confirmation' && bookingId) {
      logger.info('[generatePdfJob] Booking confirmation PDF generation not yet implemented', {
        jobId: job.id,
        bookingId,
      });
      // TODO: Implement booking confirmation PDF generation
      throw new Error('Booking confirmation PDF generation not yet implemented');
    } else {
      throw new Error(`Unsupported PDF type or missing ID: ${type}`);
    }

    await job.progress(100);

    return {
      success: true,
      jobId: job.id,
      type,
      fileName,
      fileSize: pdfBuffer.length,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.error('[generatePdfJob] Error generating PDF', {
      jobId: job.id,
      type,
      quoteId,
      error: err.message,
      stack: err.stack,
      metadata,
    });

    throw err;
  }
}

/**
 * Helper to queue a quote PDF generation
 */
async function queueQuotePdf(pdfQueue, quoteId, priority = 'normal') {
  return await pdfQueue.add(
    {
      type: 'quote',
      quoteId,
      metadata: {
        queuedAt: new Date().toISOString(),
      },
    },
    {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: true,
      removeOnFail: false,
      priority: priority === 'high' ? 2 : priority === 'low' ? -1 : 0,
    }
  );
}

/**
 * Helper to queue an invoice PDF generation
 */
async function queueInvoicePdf(pdfQueue, invoiceId, priority = 'normal') {
  return await pdfQueue.add(
    {
      type: 'invoice',
      invoiceId,
      metadata: {
        queuedAt: new Date().toISOString(),
      },
    },
    {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: true,
      removeOnFail: false,
      priority: priority === 'high' ? 2 : priority === 'low' ? -1 : 0,
    }
  );
}

module.exports = {
  generatePdfJob,
  queueQuotePdf,
  queueInvoicePdf,
};
