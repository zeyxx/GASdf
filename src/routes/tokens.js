const express = require('express');
const router = express.Router();
const tokenGate = require('../services/token-gate');

// GET /v1/tokens — list accepted payment tokens
router.get('/', (req, res) => {
  res.json({
    tokens: tokenGate.getAcceptedTokens(),
    count: tokenGate.getAcceptedTokens().length,
  });
});

module.exports = router;
