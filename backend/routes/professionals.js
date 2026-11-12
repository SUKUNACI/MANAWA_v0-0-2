const express = require('express');

const router = express.Router();

// Placeholder route for professionals endpoints
// This can be extended with professional-specific functionality

router.get('/', (req, res) => {
  res.json({ message: 'Professionals endpoint' });
});

module.exports = router;
