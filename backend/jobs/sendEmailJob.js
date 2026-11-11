const Mailjet = require('node-mailjet');
const logger = require('../utils/logger');

const MJ_API_KEY = process.env.MAILJET_API_KEY;
const MJ_SECRET_KEY = process.env.MAILJET_SECRET_KEY;
const FROM_EMAIL = process.env.MAILJET_FROM_EMAIL || 'noreply@manawa.app';
const FROM_NAME = process.env.MAILJET_FROM_NAME || 'MANAWA';

const isConfigured = !!(MJ_API_KEY && MJ_SECRET_KEY);

let mailjet = null;
if (isConfigured) {
  mailjet = new Mailjet({ apiKey: MJ_API_KEY, apiSecret: MJ_SECRET_KEY });
}

/**
 * Send email job processor
 * Processes email jobs from the queue
 *
 * Job data shape:
 * {
 *   to: string (recipient email),
 *   subject: string,
 *   htmlPart: string (HTML email body),
 *   textPart: string (plain text fallback),
 *   replyTo?: string,
 *   priority?: 'low' | 'normal' | 'high',
 *   metadata?: object (for tracking/logging)
 * }
 */
async function sendEmailJob(job) {
  const { to, subject, htmlPart, textPart, replyTo, metadata } = job.data;

  // Validation
  if (!to || !subject) {
    throw new Error('Missing required fields: to, subject');
  }

  if (!isConfigured) {
    logger.warn('[sendEmailJob] Mailjet not configured, skipping email', {
      jobId: job.id,
      to,
      subject,
      metadata,
    });
    return { sent: false, reason: 'mailjet_not_configured', jobId: job.id };
  }

  try {
    // Update job progress
    await job.progress(10);

    logger.debug('[sendEmailJob] Sending email', {
      jobId: job.id,
      to,
      subject,
      metadata,
    });

    // Build message
    const message = {
      From: { Email: FROM_EMAIL, Name: FROM_NAME },
      To: [{ Email: to }],
      Subject: subject,
      TextPart: textPart || '',
      HTMLPart: htmlPart || '',
    };

    if (replyTo) {
      message.ReplyTo = { Email: replyTo };
    }

    await job.progress(50);

    // Send via Mailjet
    const response = await mailjet
      .post('send', { version: 'v3.1' })
      .request({
        Messages: [message],
      });

    await job.progress(90);

    const status = response.body?.Messages?.[0]?.Status;
    if (status && status !== 'success') {
      throw new Error(`Mailjet message status: ${status}`);
    }

    const messageId = response.body?.Messages?.[0]?.ID;

    logger.info('[sendEmailJob] Email sent successfully', {
      jobId: job.id,
      to,
      subject,
      messageId,
      metadata,
    });

    await job.progress(100);

    return {
      sent: true,
      jobId: job.id,
      messageId,
      to,
      subject,
      sentAt: new Date().toISOString(),
    };
  } catch (err) {
    const statusCode = err.statusCode || err.response?.statusCode;
    const errorInfo = err.response?.body || err.message;

    logger.error('[sendEmailJob] Error sending email', {
      jobId: job.id,
      to,
      subject,
      statusCode,
      errorInfo,
      metadata,
      error: err.message,
    });

    // Determine if error is retryable
    if (statusCode === 401) {
      throw new Error('Mailjet: invalid API credentials - will not retry');
    }
    if (statusCode === 429) {
      throw new Error('Mailjet: rate limited - will retry with backoff');
    }
    if (statusCode >= 500) {
      throw new Error(`Mailjet: server error (${statusCode}) - will retry`);
    }

    throw err;
  }
}

/**
 * Helper to send confirmation email (booking)
 */
async function createBookingConfirmationEmail(emailQueue, bookingData) {
  const { clientEmail, clientName, professionalName, date, time, location, bookingId } = bookingData;

  const subject = 'Confirmation de votre réservation — MANAWA';
  const htmlPart = `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;background:#0A0D14;color:#fff;border-radius:12px;">
      <h2 style="color:#F97316;margin-bottom:8px;">MANAWA</h2>
      <h3 style="color:#fff;margin-bottom:24px;">Réservation confirmée</h3>
      <div style="background:#1A1F2E;border-radius:10px;padding:24px;margin-bottom:24px;">
        <p style="color:#9CA3AF;margin-bottom:16px;"><strong style="color:#fff;">Client:</strong> ${clientName}</p>
        <p style="color:#9CA3AF;margin-bottom:16px;"><strong style="color:#fff;">Professionnel:</strong> ${professionalName}</p>
        <p style="color:#9CA3AF;margin-bottom:16px;"><strong style="color:#fff;">Date:</strong> ${date} à ${time}</p>
        <p style="color:#9CA3AF;margin-bottom:0;"><strong style="color:#fff;">Lieu:</strong> ${location}</p>
      </div>
      <p style="color:#9CA3AF;font-size:13px;">Référence: ${bookingId}</p>
      <p style="color:#6B7280;font-size:12px;margin-top:24px;">— L'équipe MANAWA</p>
    </div>`;

  const textPart = `
Réservation confirmée

Client: ${clientName}
Professionnel: ${professionalName}
Date: ${date} à ${time}
Lieu: ${location}
Référence: ${bookingId}
`;

  return await emailQueue.add(
    {
      to: clientEmail,
      subject,
      htmlPart,
      textPart,
      metadata: {
        type: 'booking_confirmation',
        bookingId,
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
    }
  );
}

/**
 * Helper to send cancellation email
 */
async function createCancellationEmail(emailQueue, cancellationData) {
  const { recipientEmail, recipientName, type, reason, bookingId } = cancellationData;

  const subject = type === 'booking'
    ? 'Annulation de votre réservation — MANAWA'
    : 'Annulation de votre devis — MANAWA';

  const htmlPart = `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;background:#0A0D14;color:#fff;border-radius:12px;">
      <h2 style="color:#F97316;margin-bottom:8px;">MANAWA</h2>
      <h3 style="color:#EF4444;margin-bottom:24px;">Annulation notifiée</h3>
      <div style="background:#1A1F2E;border-radius:10px;padding:24px;margin-bottom:24px;">
        <p style="color:#9CA3AF;margin-bottom:16px;"><strong style="color:#fff;">Destinataire:</strong> ${recipientName}</p>
        <p style="color:#9CA3AF;margin-bottom:16px;"><strong style="color:#fff;">Type:</strong> ${type === 'booking' ? 'Réservation' : 'Devis'}</p>
        ${reason ? `<p style="color:#9CA3AF;margin-bottom:0;"><strong style="color:#fff;">Raison:</strong> ${reason}</p>` : ''}
      </div>
      <p style="color:#9CA3AF;font-size:13px;">Référence: ${bookingId}</p>
      <p style="color:#6B7280;font-size:12px;margin-top:24px;">— L'équipe MANAWA</p>
    </div>`;

  const textPart = `
Annulation notifiée

Destinataire: ${recipientName}
Type: ${type === 'booking' ? 'Réservation' : 'Devis'}
${reason ? `Raison: ${reason}` : ''}
Référence: ${bookingId}
`;

  return await emailQueue.add(
    {
      to: recipientEmail,
      subject,
      htmlPart,
      textPart,
      metadata: {
        type: 'cancellation',
        refType: type,
        bookingId,
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
    }
  );
}

module.exports = {
  sendEmailJob,
  createBookingConfirmationEmail,
  createCancellationEmail,
};
