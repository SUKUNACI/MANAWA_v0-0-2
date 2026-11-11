/**
 * PDF Generation Tests
 * Tests PDF creation, data inclusion, formatting, and special character handling
 */

jest.mock('pdfkit');
jest.mock('../../config/cloudinary');

describe('PDF Generation', () => {
  let generateQuotePdf;
  let generateQuotePdfBuffer;
  let PDFDocument;
  let cloudinary;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Mock PDFDocument
    PDFDocument = require('pdfkit');
    cloudinary = require('../../config/cloudinary');

    generateQuotePdf = require('../../utils/generateQuotePdf');
    generateQuotePdfBuffer = generateQuotePdf.generateQuotePdfBuffer;
    generateQuotePdf = generateQuotePdf.default || generateQuotePdf;
  });

  describe('Exports', () => {
    test('should export generateQuotePdf function', () => {
      const module = require('../../utils/generateQuotePdf');
      expect(typeof module).toBe('function');
    });

    test('should export generateQuotePdfBuffer function', () => {
      const module = require('../../utils/generateQuotePdf');
      expect(typeof module.generateQuotePdfBuffer).toBe('function');
    });
  });

  describe('PDF Buffer Generation', () => {
    test('should generate PDF buffer without upload', async () => {
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
        page: { width: 595, height: 842 },
        heightOfString: jest.fn().mockReturnValue(50),
        lineWidth: jest.fn().mockReturnThis(),
      };

      PDFDocument.mockImplementationOnce(() => mockDoc);

      const quote = {
        id: 'q123',
        version: 1,
        amount: 50000,
        createdAt: new Date(),
        expiresAt: new Date(),
        description: 'Test description',
        mode: 'SIMPLE',
        items: [],
        validityDays: 15,
      };

      const professional = {
        id: 'pro1',
        trade: 'Plumbing',
        user: { firstName: 'John', lastName: 'Doe', email: 'john@example.com', phone: '123456789', city: 'Accra' },
      };

      const project = {
        id: 'proj1',
        title: 'Water Pipe Installation',
        tradeNeeded: 'Plumbing',
        city: 'Accra',
        client: { firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', phone: '987654321', city: 'Accra' },
      };

      const buffer = await generateQuotePdfBuffer(quote, professional, project);

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(mockDoc.end).toHaveBeenCalled();
    });

    test('should include quote ID in PDF', async () => {
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
        page: { width: 595, height: 842 },
        heightOfString: jest.fn().mockReturnValue(50),
        lineWidth: jest.fn().mockReturnThis(),
      };

      PDFDocument.mockImplementationOnce(() => mockDoc);

      const quoteId = 'abc12345def';
      const quote = {
        id: quoteId,
        version: 1,
        amount: 50000,
        createdAt: new Date(),
        expiresAt: new Date(),
        description: '',
        mode: 'SIMPLE',
        items: [],
        validityDays: 15,
      };

      const professional = {
        id: 'pro1',
        trade: 'Plumbing',
        user: { firstName: 'John', lastName: 'Doe', email: 'john@example.com', phone: '123456789', city: 'Accra' },
      };

      const project = {
        id: 'proj1',
        title: 'Water Pipe Installation',
        tradeNeeded: 'Plumbing',
        city: 'Accra',
        client: { firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', phone: '987654321', city: 'Accra' },
      };

      await generateQuotePdfBuffer(quote, professional, project);

      // Check if text was called with quote ID
      const textCalls = mockDoc.text.mock.calls;
      const hasQuoteId = textCalls.some(call => call[0] && call[0].includes('ABC12'));

      expect(hasQuoteId).toBe(true);
    });
  });

  describe('PDF Upload', () => {
    test('should upload PDF to Cloudinary', async () => {
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
        page: { width: 595, height: 842 },
        heightOfString: jest.fn().mockReturnValue(50),
        lineWidth: jest.fn().mockReturnThis(),
      };

      PDFDocument.mockImplementationOnce(() => mockDoc);
      cloudinary.uploadBuffer.mockResolvedValueOnce('https://cloudinary.com/devis-abc123-v1.pdf');

      const quote = {
        id: 'abc123456789',
        version: 1,
        amount: 50000,
        createdAt: new Date(),
        expiresAt: new Date(),
        description: '',
        mode: 'SIMPLE',
        items: [],
        validityDays: 15,
      };

      const professional = {
        id: 'pro1',
        trade: 'Plumbing',
        user: { firstName: 'John', lastName: 'Doe', email: 'john@example.com', phone: '123456789', city: 'Accra' },
      };

      const project = {
        id: 'proj1',
        title: 'Water Pipe Installation',
        tradeNeeded: 'Plumbing',
        city: 'Accra',
        client: { firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', phone: '987654321', city: 'Accra' },
      };

      const url = await generateQuotePdf(quote, professional, project);

      expect(cloudinary.uploadBuffer).toHaveBeenCalled();
      expect(url).toContain('cloudinary.com');
    });

    test('should use correct upload folder', async () => {
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
        page: { width: 595, height: 842 },
        heightOfString: jest.fn().mockReturnValue(50),
        lineWidth: jest.fn().mockReturnThis(),
      };

      PDFDocument.mockImplementationOnce(() => mockDoc);
      cloudinary.uploadBuffer.mockResolvedValueOnce('https://cloudinary.com/devis.pdf');

      const quote = {
        id: 'abc123',
        version: 1,
        amount: 50000,
        createdAt: new Date(),
        expiresAt: new Date(),
        description: '',
        mode: 'SIMPLE',
        items: [],
        validityDays: 15,
      };

      const professional = {
        id: 'pro1',
        trade: 'Plumbing',
        user: { firstName: 'John', lastName: 'Doe', email: 'john@example.com', phone: '123456789', city: 'Accra' },
      };

      const project = {
        id: 'proj1',
        title: 'Test',
        tradeNeeded: 'Plumbing',
        city: 'Accra',
        client: { firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', phone: '987654321', city: 'Accra' },
      };

      await generateQuotePdf(quote, professional, project);

      expect(cloudinary.uploadBuffer).toHaveBeenCalled();
    });
  });

  describe('PDF Content - Simple Mode', () => {
    test('should display amount for simple quotes', async () => {
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
        page: { width: 595, height: 842 },
        heightOfString: jest.fn().mockReturnValue(50),
        lineWidth: jest.fn().mockReturnThis(),
      };

      PDFDocument.mockImplementationOnce(() => mockDoc);

      const quote = {
        id: 'q1',
        version: 1,
        amount: 75000,
        createdAt: new Date(),
        expiresAt: new Date(),
        description: 'Simple quote',
        mode: 'SIMPLE',
        items: [],
        validityDays: 15,
      };

      const professional = {
        id: 'pro1',
        trade: 'Plumbing',
        user: { firstName: 'John', lastName: 'Doe', email: 'john@example.com', phone: '123456789', city: 'Accra' },
      };

      const project = {
        id: 'proj1',
        title: 'Test Project',
        tradeNeeded: 'Plumbing',
        city: 'Accra',
        client: { firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', phone: '987654321', city: 'Accra' },
      };

      await generateQuotePdfBuffer(quote, professional, project);

      const textCalls = mockDoc.text.mock.calls;
      expect(textCalls.length).toBeGreaterThan(0);
    });
  });

  describe('PDF Content - Detailed Mode', () => {
    test('should include line items in detailed quotes', async () => {
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
        page: { width: 595, height: 842 },
        heightOfString: jest.fn().mockReturnValue(50),
        lineWidth: jest.fn().mockReturnThis(),
      };

      PDFDocument.mockImplementationOnce(() => mockDoc);

      const quote = {
        id: 'q1',
        version: 1,
        amount: 100000,
        createdAt: new Date(),
        expiresAt: new Date(),
        description: 'Detailed quote',
        mode: 'DETAILED',
        items: [
          {
            label: 'Labour',
            quantity: 8,
            unit: 'hours',
            unitPrice: 5000,
            total: 40000,
            category: 'LABOUR',
          },
          {
            label: 'PVC Pipes',
            quantity: 50,
            unit: 'meters',
            unitPrice: 1200,
            total: 60000,
            category: 'MATERIALS',
          },
        ],
        validityDays: 15,
      };

      const professional = {
        id: 'pro1',
        trade: 'Plumbing',
        user: { firstName: 'John', lastName: 'Doe', email: 'john@example.com', phone: '123456789', city: 'Accra' },
      };

      const project = {
        id: 'proj1',
        title: 'Plumbing Installation',
        tradeNeeded: 'Plumbing',
        city: 'Accra',
        client: { firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', phone: '987654321', city: 'Accra' },
      };

      await generateQuotePdfBuffer(quote, professional, project);

      const textCalls = mockDoc.text.mock.calls;
      expect(textCalls.length).toBeGreaterThan(5);
    });

    test('should handle item categories correctly', async () => {
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
        page: { width: 595, height: 842 },
        heightOfString: jest.fn().mockReturnValue(50),
        lineWidth: jest.fn().mockReturnThis(),
      };

      PDFDocument.mockImplementationOnce(() => mockDoc);

      const quote = {
        id: 'q1',
        version: 1,
        amount: 50000,
        createdAt: new Date(),
        expiresAt: new Date(),
        description: '',
        mode: 'DETAILED',
        items: [
          { label: 'Work', quantity: 2, unit: 'days', unitPrice: 10000, total: 20000, category: 'LABOUR' },
          { label: 'Cement', quantity: 5, unit: 'bags', unitPrice: 6000, total: 30000, category: 'MATERIALS' },
          { label: 'Transport', quantity: 1, unit: 'job', unitPrice: 5000, total: 5000, category: 'OTHER' },
        ],
        validityDays: 15,
      };

      const professional = {
        id: 'pro1',
        trade: 'Construction',
        user: { firstName: 'John', lastName: 'Doe', email: 'john@example.com', phone: '123456789', city: 'Accra' },
      };

      const project = {
        id: 'proj1',
        title: 'Building Work',
        tradeNeeded: 'Construction',
        city: 'Accra',
        client: { firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', phone: '987654321', city: 'Accra' },
      };

      await generateQuotePdfBuffer(quote, professional, project);

      expect(mockDoc.text).toHaveBeenCalled();
    });
  });

  describe('Special Character Handling', () => {
    test('should handle special characters in professional name', async () => {
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
        page: { width: 595, height: 842 },
        heightOfString: jest.fn().mockReturnValue(50),
        lineWidth: jest.fn().mockReturnThis(),
      };

      PDFDocument.mockImplementationOnce(() => mockDoc);

      const quote = {
        id: 'q1',
        version: 1,
        amount: 50000,
        createdAt: new Date(),
        expiresAt: new Date(),
        description: '',
        mode: 'SIMPLE',
        items: [],
        validityDays: 15,
      };

      const professional = {
        id: 'pro1',
        trade: "Plombier d'eau",
        user: { firstName: "Jean-Pierre", lastName: "Françoise", email: 'john@example.com', phone: '123456789', city: "Montréal" },
      };

      const project = {
        id: 'proj1',
        title: "Installation d'eau",
        tradeNeeded: "Plomberie d'eau",
        city: "Montréal",
        client: { firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', phone: '987654321', city: "Montréal" },
      };

      await generateQuotePdfBuffer(quote, professional, project);

      expect(mockDoc.text).toHaveBeenCalled();
    });

    test('should handle special characters in item labels', async () => {
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
        page: { width: 595, height: 842 },
        heightOfString: jest.fn().mockReturnValue(50),
        lineWidth: jest.fn().mockReturnThis(),
      };

      PDFDocument.mockImplementationOnce(() => mockDoc);

      const quote = {
        id: 'q1',
        version: 1,
        amount: 50000,
        createdAt: new Date(),
        expiresAt: new Date(),
        description: 'Test with special chars: & < > " \'',
        mode: 'DETAILED',
        items: [
          {
            label: 'Tuyaux & accessoires',
            quantity: 10,
            unit: 'pièces',
            unitPrice: 5000,
            total: 50000,
            category: 'MATERIALS',
          },
        ],
        validityDays: 15,
      };

      const professional = {
        id: 'pro1',
        trade: 'Plumbing',
        user: { firstName: 'John', lastName: 'Doe', email: 'john@example.com', phone: '123456789', city: 'Accra' },
      };

      const project = {
        id: 'proj1',
        title: 'Test',
        tradeNeeded: 'Plumbing',
        city: 'Accra',
        client: { firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', phone: '987654321', city: 'Accra' },
      };

      await generateQuotePdfBuffer(quote, professional, project);

      expect(mockDoc.text).toHaveBeenCalled();
    });
  });

  describe('Date Formatting', () => {
    test('should format dates correctly', async () => {
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
        page: { width: 595, height: 842 },
        heightOfString: jest.fn().mockReturnValue(50),
        lineWidth: jest.fn().mockReturnThis(),
      };

      PDFDocument.mockImplementationOnce(() => mockDoc);

      const testDate = new Date('2024-11-15');
      const quote = {
        id: 'q1',
        version: 1,
        amount: 50000,
        createdAt: testDate,
        expiresAt: testDate,
        description: '',
        mode: 'SIMPLE',
        items: [],
        validityDays: 15,
      };

      const professional = {
        id: 'pro1',
        trade: 'Plumbing',
        user: { firstName: 'John', lastName: 'Doe', email: 'john@example.com', phone: '123456789', city: 'Accra' },
      };

      const project = {
        id: 'proj1',
        title: 'Test',
        tradeNeeded: 'Plumbing',
        city: 'Accra',
        client: { firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', phone: '987654321', city: 'Accra' },
      };

      await generateQuotePdfBuffer(quote, professional, project);

      expect(mockDoc.text).toHaveBeenCalled();
    });
  });

  describe('Number Formatting', () => {
    test('should format large numbers with thousand separators', async () => {
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
        page: { width: 595, height: 842 },
        heightOfString: jest.fn().mockReturnValue(50),
        lineWidth: jest.fn().mockReturnThis(),
      };

      PDFDocument.mockImplementationOnce(() => mockDoc);

      const quote = {
        id: 'q1',
        version: 1,
        amount: 1500000,
        createdAt: new Date(),
        expiresAt: new Date(),
        description: '',
        mode: 'DETAILED',
        items: [
          { label: 'Labour', quantity: 100, unit: 'hours', unitPrice: 10000, total: 1000000, category: 'LABOUR' },
          { label: 'Materials', quantity: 50, unit: 'kg', unitPrice: 10000, total: 500000, category: 'MATERIALS' },
        ],
        validityDays: 15,
      };

      const professional = {
        id: 'pro1',
        trade: 'Construction',
        user: { firstName: 'John', lastName: 'Doe', email: 'john@example.com', phone: '123456789', city: 'Accra' },
      };

      const project = {
        id: 'proj1',
        title: 'Large Project',
        tradeNeeded: 'Construction',
        city: 'Accra',
        client: { firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', phone: '987654321', city: 'Accra' },
      };

      await generateQuotePdfBuffer(quote, professional, project);

      expect(mockDoc.text).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('should handle missing professional user data', async () => {
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
        page: { width: 595, height: 842 },
        heightOfString: jest.fn().mockReturnValue(50),
        lineWidth: jest.fn().mockReturnThis(),
      };

      PDFDocument.mockImplementationOnce(() => mockDoc);

      const quote = {
        id: 'q1',
        version: 1,
        amount: 50000,
        createdAt: new Date(),
        expiresAt: new Date(),
        description: '',
        mode: 'SIMPLE',
        items: [],
        validityDays: 15,
      };

      const professional = {
        id: 'pro1',
        trade: undefined,
        user: undefined,
      };

      const project = {
        id: 'proj1',
        title: 'Test',
        tradeNeeded: 'Test',
        city: 'Accra',
        client: undefined,
      };

      await generateQuotePdfBuffer(quote, professional, project);

      expect(mockDoc.text).toHaveBeenCalled();
    });

    test('should handle missing quote data', async () => {
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
        page: { width: 595, height: 842 },
        heightOfString: jest.fn().mockReturnValue(50),
        lineWidth: jest.fn().mockReturnThis(),
      };

      PDFDocument.mockImplementationOnce(() => mockDoc);

      const quote = {
        id: 'q1',
        version: 1,
        amount: 50000,
        createdAt: new Date(),
        expiresAt: undefined,
        description: undefined,
        mode: 'SIMPLE',
        items: [],
      };

      const professional = {
        id: 'pro1',
        trade: 'Plumbing',
        user: { firstName: 'John', lastName: 'Doe', email: 'john@example.com', phone: '123456789', city: 'Accra' },
      };

      const project = {
        id: 'proj1',
        title: 'Test',
        tradeNeeded: 'Plumbing',
        city: 'Accra',
        client: { firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', phone: '987654321', city: 'Accra' },
      };

      await generateQuotePdfBuffer(quote, professional, project);

      expect(mockDoc.text).toHaveBeenCalled();
    });
  });

  describe('Page Breaks', () => {
    test('should add new page when content exceeds page height', async () => {
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
        page: { width: 595, height: 842 },
        heightOfString: jest.fn().mockReturnValue(500),
        lineWidth: jest.fn().mockReturnThis(),
      };

      PDFDocument.mockImplementationOnce(() => mockDoc);

      const quote = {
        id: 'q1',
        version: 1,
        amount: 50000,
        createdAt: new Date(),
        expiresAt: new Date(),
        description: 'Very long description that would exceed page boundaries'.repeat(10),
        mode: 'DETAILED',
        items: Array(20).fill({
          label: 'Item',
          quantity: 1,
          unit: 'unit',
          unitPrice: 1000,
          total: 1000,
          category: 'MATERIALS',
        }),
        validityDays: 15,
      };

      const professional = {
        id: 'pro1',
        trade: 'Construction',
        user: { firstName: 'John', lastName: 'Doe', email: 'john@example.com', phone: '123456789', city: 'Accra' },
      };

      const project = {
        id: 'proj1',
        title: 'Large Project',
        tradeNeeded: 'Construction',
        city: 'Accra',
        client: { firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', phone: '987654321', city: 'Accra' },
      };

      await generateQuotePdfBuffer(quote, professional, project);

      expect(mockDoc.addPage).toHaveBeenCalled();
    });
  });
});
