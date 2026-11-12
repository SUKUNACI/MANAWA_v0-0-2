const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({ message: 'Packages endpoint' });
});

module.exports = router;
