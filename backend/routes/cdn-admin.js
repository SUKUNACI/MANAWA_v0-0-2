const express = require('express');
const { body } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');
const CDNHelper = require('../utils/cdn-helpers');
const { cloudinary } = require('../config/cdn');
const CDNAdminModule = require('../modules/CDNAdminModule');

const router = express.Router();
const cdnModule = new CDNAdminModule(CDNHelper, cloudinary);

router.use(requireAuth);
router.use(requireRole('admin'));

router.get('/stats', async (req, res) => { try { const s = await cdnModule.getStats(); res.json({ success: true, data: s }); } catch (err) { res.status(500).json({ success: false, error: 'Failed to fetch' }); } });

router.get('/resources', async (req, res) => { try { if (!req.query.folder) return res.status(400).json({ success: false, error: 'folder required' }); const r = await cdnModule.listResources(req.query.folder, req.query.limit); res.json({ success: true, data: r }); } catch (err) { res.status(500).json({ success: false, error: 'Failed to list' }); } });

router.get('/resource/:publicId', async (req, res) => { try { const m = await cdnModule.getResourceMetadata(req.params.publicId); res.json({ success: true, data: m }); } catch (err) { res.status(500).json({ success: false, error: 'Failed to fetch' }); } });

router.post('/purge', [body('method').notEmpty(), body('url').optional(), body('folder').optional(), body('tag').optional()], async (req, res) => { try { const r = await cdnModule.purge(req.body); res.json({ success: true, data: r }); } catch (err) { err.message.includes('required') ? res.status(400).json({ success: false, error: err.message }) : res.status(err.message.includes('only') ? 403 : 500).json({ success: false, error: err.message }); } });

router.delete('/resources', [body('publicIds').isArray({ min: 1, max: 500 })], async (req, res) => { try { if (!req.body.publicIds?.length) return res.status(400).json({ success: false, error: 'publicIds required' }); const r = await cdnModule.deleteResources(req.body.publicIds); res.json({ success: true, data: { deleted: r.deleted } }); } catch (err) { res.status(err.message.includes('Maximum') ? 400 : 500).json({ success: false, error: err.message }); } });

router.get('/transformations', async (req, res) => { res.json({ success: true, data: cdnModule.getTransformations() }); });

router.get('/cache-config', async (req, res) => { res.json({ success: true, data: cdnModule.getCacheConfig() }); });

router.post('/cleanup', async (req, res) => { try { const r = await cdnModule.cleanup(); res.json({ success: true, data: r }); } catch (err) { res.status(500).json({ success: false, error: err.message }); } });

router.get('/health', async (req, res) => { try { const h = await cdnModule.health(); res.json({ success: true, data: h }); } catch (err) { res.status(503).json({ success: false, error: err.message }); } });

module.exports = router;
