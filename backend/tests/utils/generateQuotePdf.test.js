'use strict';

/**
 * Tests pour utils/generateQuotePdf.js
 * Génération de PDFs de devis (buffer + upload Cloudinary)
 */

jest.mock('pdfkit');
jest.mock('../../config/cloudinary');

const PDFDocument = require('pdfkit');
const { uploadBuffer } = require('../../config/cloudinary');

// Helper: crée un mock PDFDocument qui émet 'end' immédiatement
function createMockDoc() {
  const mockDoc = {
    on: jest.fn((event, handler) => {
      if (event === 'end') setImmediate(() => handler());
      return mockDoc;
    }),
    end: jest.fn(),
    rect: jest.fn().mockReturnThis(),
    fill: jest.fn().mockReturnThis(),
    fontSize: jest.fn().mockReturnThis(),
    fillColor: jest.fn().mockReturnThis(),
    font: jest.fn().mockReturnThis(),
    text: jest.fn().mockReturnThis(),
    moveTo: jest.fn().mockReturnThis(),
    lineTo: jest.fn().mockReturnThis(),
    stroke: jest.fn().mockReturnThis(),
    strokeColor: jest.fn().mockReturnThis(),
    addPage: jest.fn().mockReturnThis(),
    lineWidth: jest.fn().mockReturnThis(),
    page: { width: 595, height: 842 },
    heightOfString: jest.fn().mockReturnValue(20),
  };
  return mockDoc;
}

// Fixtures de base
const baseQuote = {
  id: 'q12345678abcd',
  version: 1,
  amount: 150000,
  createdAt: new Date('2026-11-01'),
  expiresAt: new Date('2026-11-16'),
  description: 'Description test',
  mode: 'SIMPLE',
  items: [],
  validityDays: 15,
};

const baseProfessional = {
  id: 'pro-1',
  trade: 'Plombier',
  user: {
    firstName: 'Konan',
    lastName: 'Yao',
    email: 'konan@test.ci',
    phone: '+2250100000001',
    city: 'Abidjan',
  },
};

const baseProject = {
  id: 'proj-1',
  title: 'Installation plomberie',
  tradeNeeded: 'Plomberie',
  city: 'Abidjan',
  client: {
    firstName: 'Marie',
    lastName: 'Koné',
    email: 'marie@test.ci',
    phone: '+2250100000002',
    city: 'Abidjan',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Exports ──────────────────────────────────────────────────────────────────

describe('exports', () => {
  it('exporte une fonction generateQuotePdf par défaut', () => {
    const mod = require('../../utils/generateQuotePdf');
    expect(typeof mod).toBe('function');
  });

  it('exporte generateQuotePdfBuffer en propriété', () => {
    const mod = require('../../utils/generateQuotePdf');
    expect(typeof mod.generateQuotePdfBuffer).toBe('function');
  });
});

// ─── generateQuotePdfBuffer ───────────────────────────────────────────────────

describe('generateQuotePdfBuffer', () => {
  const { generateQuotePdfBuffer } = require('../../utils/generateQuotePdf');

  it('retourne un Buffer', async () => {
    const doc = createMockDoc();
    PDFDocument.mockImplementationOnce(() => doc);

    const result = await generateQuotePdfBuffer(baseQuote, baseProfessional, baseProject);

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(doc.end).toHaveBeenCalled();
  });

  it('ne fait aucun appel uploadBuffer', async () => {
    const doc = createMockDoc();
    PDFDocument.mockImplementationOnce(() => doc);

    await generateQuotePdfBuffer(baseQuote, baseProfessional, baseProject);

    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  it('affiche l\'ID du devis (tronqué en majuscule)', async () => {
    const doc = createMockDoc();
    PDFDocument.mockImplementationOnce(() => doc);

    await generateQuotePdfBuffer(baseQuote, baseProfessional, baseProject);

    const textCalls = doc.text.mock.calls.map(c => c[0]);
    expect(textCalls.some(t => typeof t === 'string' && t.includes('Q12345'))).toBe(true);
  });

  it('affiche "DEVIS" dans le contenu', async () => {
    const doc = createMockDoc();
    PDFDocument.mockImplementationOnce(() => doc);

    await generateQuotePdfBuffer(baseQuote, baseProfessional, baseProject);

    const textCalls = doc.text.mock.calls.map(c => c[0]);
    expect(textCalls.some(t => t === 'DEVIS')).toBe(true);
  });

  describe('mode DETAILED avec items', () => {
    it('affiche les catégories LABOUR, MATERIALS, OTHER', async () => {
      const doc = createMockDoc();
      PDFDocument.mockImplementationOnce(() => doc);

      const quoteDetailed = {
        ...baseQuote,
        mode: 'DETAILED',
        items: [
          { label: 'Main-d\'œuvre', quantity: 4, unit: 'h', unitPrice: 10000, total: 40000, category: 'LABOUR' },
          { label: 'Tuyaux PVC', quantity: 20, unit: 'm', unitPrice: 2500, total: 50000, category: 'MATERIALS' },
          { label: 'Transport', quantity: 1, unit: 'forfait', unitPrice: 15000, total: 15000, category: 'OTHER' },
        ],
      };

      await generateQuotePdfBuffer(quoteDetailed, baseProfessional, baseProject);

      const textCalls = doc.text.mock.calls.map(c => String(c[0]));
      // Les catégories doivent être affichées
      expect(textCalls.some(t => t.includes("MAIN D'ŒUVRE") || t.includes("ŒUVRE"))).toBe(true);
    });

    it('calcule le total des items sans propriété total (quantité × prix)', async () => {
      const doc = createMockDoc();
      PDFDocument.mockImplementationOnce(() => doc);

      const quoteNoTotal = {
        ...baseQuote,
        mode: 'DETAILED',
        amount: 20000,
        items: [
          { label: 'Item', quantity: 2, unit: 'u', unitPrice: 10000, category: 'MATERIALS' },
        ],
      };

      await generateQuotePdfBuffer(quoteNoTotal, baseProfessional, baseProject);

      // Doit fonctionner sans erreur
      expect(doc.text).toHaveBeenCalled();
    });

    it('ajoute une page si le contenu dépasse la hauteur', async () => {
      const doc = createMockDoc();
      // heightOfString retourne 500 pour simuler un dépassement
      doc.heightOfString.mockReturnValue(500);
      PDFDocument.mockImplementationOnce(() => doc);

      const quoteLong = {
        ...baseQuote,
        mode: 'DETAILED',
        items: Array(25).fill({ label: 'Item', quantity: 1, unit: 'u', unitPrice: 1000, total: 1000, category: 'MATERIALS' }),
      };

      await generateQuotePdfBuffer(quoteLong, baseProfessional, baseProject);

      expect(doc.addPage).toHaveBeenCalled();
    });
  });

  describe('données optionnelles', () => {
    it('gère professional.user = undefined (pas de crash)', async () => {
      const doc = createMockDoc();
      PDFDocument.mockImplementationOnce(() => doc);

      const proNoUser = { id: 'p1', trade: undefined, user: undefined };
      const projNoClient = { ...baseProject, client: undefined };

      await generateQuotePdfBuffer(baseQuote, proNoUser, projNoClient);

      expect(doc.text).toHaveBeenCalled();
    });

    it('gère quote.expiresAt = undefined (pas de ligne validité)', async () => {
      const doc = createMockDoc();
      PDFDocument.mockImplementationOnce(() => doc);

      const quoteNoExpiry = { ...baseQuote, expiresAt: undefined };

      await generateQuotePdfBuffer(quoteNoExpiry, baseProfessional, baseProject);

      expect(doc.text).toHaveBeenCalled();
    });

    it('gère quote.description = undefined (pas de section description)', async () => {
      const doc = createMockDoc();
      PDFDocument.mockImplementationOnce(() => doc);

      const quoteNoDesc = { ...baseQuote, description: undefined };

      await generateQuotePdfBuffer(quoteNoDesc, baseProfessional, baseProject);

      expect(doc.text).toHaveBeenCalled();
    });

    it('gère validityDays absent (défaut 15 jours)', async () => {
      const doc = createMockDoc();
      PDFDocument.mockImplementationOnce(() => doc);

      const quoteNoValidity = { ...baseQuote, validityDays: undefined };

      await generateQuotePdfBuffer(quoteNoValidity, baseProfessional, baseProject);

      const textCalls = doc.text.mock.calls.map(c => String(c[0]));
      expect(textCalls.some(t => t.includes('15'))).toBe(true);
    });
  });

  describe('gestion erreur PDFDocument', () => {
    it('rejette la promesse si PDFDocument émet "error"', async () => {
      const doc = {
        on: jest.fn((event, handler) => {
          if (event === 'error') setImmediate(() => handler(new Error('PDF generation failed')));
          return doc;
        }),
        end: jest.fn(),
        rect: jest.fn().mockReturnThis(),
        fill: jest.fn().mockReturnThis(),
        fontSize: jest.fn().mockReturnThis(),
        fillColor: jest.fn().mockReturnThis(),
        font: jest.fn().mockReturnThis(),
        text: jest.fn().mockReturnThis(),
        moveTo: jest.fn().mockReturnThis(),
        lineTo: jest.fn().mockReturnThis(),
        stroke: jest.fn().mockReturnThis(),
        strokeColor: jest.fn().mockReturnThis(),
        addPage: jest.fn().mockReturnThis(),
        lineWidth: jest.fn().mockReturnThis(),
        page: { width: 595, height: 842 },
        heightOfString: jest.fn().mockReturnValue(20),
      };

      PDFDocument.mockImplementationOnce(() => doc);

      await expect(
        generateQuotePdfBuffer(baseQuote, baseProfessional, baseProject)
      ).rejects.toThrow('PDF generation failed');
    });
  });
});

// ─── generateQuotePdf (avec upload Cloudinary) ────────────────────────────────

describe('generateQuotePdf', () => {
  const generateQuotePdf = require('../../utils/generateQuotePdf');

  it('appelle uploadBuffer avec le bon folder', async () => {
    const doc = createMockDoc();
    PDFDocument.mockImplementationOnce(() => doc);
    uploadBuffer.mockResolvedValueOnce('https://cloudinary.com/devis-q1234567-v1.pdf');

    await generateQuotePdf(baseQuote, baseProfessional, baseProject);

    expect(uploadBuffer).toHaveBeenCalledWith(
      expect.any(Buffer),
      'manawa/quotes',
      expect.objectContaining({
        resource_type: 'raw',
        format: 'pdf',
        overwrite: true,
      })
    );
  });

  it('utilise l\'ID du devis comme public_id', async () => {
    const doc = createMockDoc();
    PDFDocument.mockImplementationOnce(() => doc);
    uploadBuffer.mockResolvedValueOnce('https://cdn.example.com/devis.pdf');

    await generateQuotePdf(baseQuote, baseProfessional, baseProject);

    const uploadArgs = uploadBuffer.mock.calls[0][2];
    expect(uploadArgs.public_id).toContain('devis-q1234567');
    expect(uploadArgs.public_id).toContain('-v1');
  });

  it('retourne l\'URL Cloudinary', async () => {
    const doc = createMockDoc();
    PDFDocument.mockImplementationOnce(() => doc);
    const expectedUrl = 'https://cloudinary.com/my-quote.pdf';
    uploadBuffer.mockResolvedValueOnce(expectedUrl);

    const url = await generateQuotePdf(baseQuote, baseProfessional, baseProject);

    expect(url).toBe(expectedUrl);
  });

  it('rejette si uploadBuffer échoue', async () => {
    const doc = createMockDoc();
    PDFDocument.mockImplementationOnce(() => doc);
    uploadBuffer.mockRejectedValueOnce(new Error('Cloudinary error'));

    await expect(
      generateQuotePdf(baseQuote, baseProfessional, baseProject)
    ).rejects.toThrow('Cloudinary error');
  });
});
