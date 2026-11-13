'use strict';

/**
 * Tests pour utils/daily.js
 * Création/suppression de rooms vidéo via l'API Daily.co
 */

// Mock axios au niveau module — axios.post et axios.delete sont mockés directement
// (daily.js appelle axios.post/delete, pas un client créé via axios.create)
jest.mock('axios', () => ({
  post: jest.fn(),
  delete: jest.fn(),
}));

const axios = require('axios');

// On garde une seule instance du module (pas de resetModules ici)
// car daily.js lit process.env.DAILY_API_KEY à l'exécution de la fonction, pas au chargement.
const { createVideoRoom, deleteVideoRoom } = require('../../utils/daily');

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DAILY_API_KEY;
});

// ─── createVideoRoom ──────────────────────────────────────────────────────────

describe('createVideoRoom', () => {
  describe('sans DAILY_API_KEY (graceful degradation)', () => {
    it('retourne null si DAILY_API_KEY non défini', async () => {
      const result = await createVideoRoom('test-room');
      expect(result).toBeNull();
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('retourne null si DAILY_API_KEY est vide string', async () => {
      process.env.DAILY_API_KEY = '';
      // empty string est falsy
      const result = await createVideoRoom('room-empty-key');
      expect(result).toBeNull();
    });
  });

  describe('avec DAILY_API_KEY défini', () => {
    beforeEach(() => {
      process.env.DAILY_API_KEY = 'test_mock_api_key_for_testing';
    });

    it('appelle axios.post avec les bons paramètres', async () => {
      const mockRoom = { id: 'room-id', name: 'my-room', url: 'https://daily.co/my-room' };
      axios.post.mockResolvedValue({ data: mockRoom });

      await createVideoRoom('my-room');

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.daily.co/v1/rooms',
        expect.objectContaining({
          name: 'my-room',
          properties: expect.objectContaining({
            enable_chat: true,
            enable_screenshare: false,
            max_participants: 2,
          }),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test_mock_api_key_for_testing',
          }),
        })
      );
    });

    it('utilise le délai d\'expiration par défaut de 60 minutes', async () => {
      axios.post.mockResolvedValue({ data: { id: 'room-1', name: 'r1', url: 'u1' } });

      const before = Math.floor(Date.now() / 1000);
      await createVideoRoom('r1');
      const after = Math.floor(Date.now() / 1000);

      const callBody = axios.post.mock.calls[0][1];
      const exp = callBody.properties.exp;

      expect(exp).toBeGreaterThanOrEqual(before + 60 * 60 - 1);
      expect(exp).toBeLessThanOrEqual(after + 60 * 60 + 1);
    });

    it('respecte le paramètre expiryMinutes personnalisé', async () => {
      axios.post.mockResolvedValue({ data: { id: 'r2', name: 'r2', url: 'u2' } });

      const before = Math.floor(Date.now() / 1000);
      await createVideoRoom('r2', 30);
      const after = Math.floor(Date.now() / 1000);

      const callBody = axios.post.mock.calls[0][1];
      const exp = callBody.properties.exp;

      expect(exp).toBeGreaterThanOrEqual(before + 30 * 60 - 1);
      expect(exp).toBeLessThanOrEqual(after + 30 * 60 + 1);
    });

    it('inclut le header Content-Type application/json', async () => {
      axios.post.mockResolvedValue({ data: {} });

      await createVideoRoom('r3');

      const headers = axios.post.mock.calls[0][2].headers;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('retourne les données de la room créée (res.data)', async () => {
      const mockData = { id: 'room-xyz', name: 'xyz', url: 'https://daily.co/xyz' };
      axios.post.mockResolvedValue({ data: mockData });

      const result = await createVideoRoom('xyz');

      expect(result).toEqual(mockData);
    });

    it('propage l\'erreur si l\'API échoue', async () => {
      axios.post.mockRejectedValue(new Error('API Error 500'));

      await expect(createVideoRoom('fail-room')).rejects.toThrow('API Error 500');
    });

    it('max_participants est 2', async () => {
      axios.post.mockResolvedValue({ data: {} });

      await createVideoRoom('r-max');

      const props = axios.post.mock.calls[0][1].properties;
      expect(props.max_participants).toBe(2);
    });
  });
});

// ─── deleteVideoRoom ──────────────────────────────────────────────────────────

describe('deleteVideoRoom', () => {
  describe('sans DAILY_API_KEY', () => {
    it('retourne undefined sans appeler axios.delete si pas de clé', async () => {
      await deleteVideoRoom('some-room');
      expect(axios.delete).not.toHaveBeenCalled();
    });
  });

  describe('avec DAILY_API_KEY défini', () => {
    beforeEach(() => {
      process.env.DAILY_API_KEY = 'test-daily-api-key-456';
    });

    it('appelle DELETE sur la bonne URL', async () => {
      axios.delete.mockResolvedValue({});

      await deleteVideoRoom('room-to-delete');

      expect(axios.delete).toHaveBeenCalledWith(
        'https://api.daily.co/v1/rooms/room-to-delete',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-daily-api-key-456',
          }),
        })
      );
    });

    it('ignore les erreurs 404 silencieusement', async () => {
      const err = new Error('Not Found');
      err.response = { status: 404 };
      axios.delete.mockRejectedValue(err);

      await expect(deleteVideoRoom('nonexistent-room')).resolves.toBeUndefined();
    });

    it('ignore toutes les erreurs (catch(() => {}))', async () => {
      axios.delete.mockRejectedValue(new Error('Network Error'));

      await expect(deleteVideoRoom('any-room')).resolves.toBeUndefined();
    });

    it('résout sans valeur de retour explicite', async () => {
      axios.delete.mockResolvedValue({});

      const result = await deleteVideoRoom('room-ok');

      expect(result).toBeUndefined();
    });

    it('utilise le bon nom de room dans l\'URL', async () => {
      axios.delete.mockResolvedValue({});

      await deleteVideoRoom('meeting-room-456');

      expect(axios.delete).toHaveBeenCalledWith(
        'https://api.daily.co/v1/rooms/meeting-room-456',
        expect.anything()
      );
    });
  });
});
