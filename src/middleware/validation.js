const { PublicKey } = require('@solana/web3.js');

// Validation helpers
function isValidSolanaAddress(address) {
  if (!address || typeof address !== 'string') return false;
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

function isValidBase64(str) {
  if (!str || typeof str !== 'string') return false;
  try {
    return Buffer.from(str, 'base64').toString('base64') === str;
  } catch {
    return false;
  }
}

function isValidUUID(str) {
  if (!str || typeof str !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// Validation schemas
const schemas = {
  quote: {
    paymentToken: {
      required: true,
      validate: isValidSolanaAddress,
      message: 'paymentToken must be a valid Solana address',
    },
    userPubkey: {
      required: true,
      validate: isValidSolanaAddress,
      message: 'userPubkey must be a valid Solana address',
    },
    estimatedComputeUnits: {
      required: false,
      validate: (v) => !v || (Number.isInteger(v) && v > 0 && v <= 1400000),
      message: 'estimatedComputeUnits must be between 1 and 1,400,000',
    },
  },

  submit: {
    quoteId: {
      required: true,
      validate: isValidUUID,
      message: 'quoteId must be a valid UUID',
    },
    transaction: {
      required: true,
      validate: isValidBase64,
      message: 'transaction must be valid base64',
    },
    userPubkey: {
      required: true,
      validate: isValidSolanaAddress,
      message: 'userPubkey must be a valid Solana address',
    },
  },
};

// Validation middleware factory
function validate(schemaName) {
  const schema = schemas[schemaName];
  if (!schema) {
    throw new Error(`Unknown validation schema: ${schemaName}`);
  }

  return (req, res, next) => {
    const errors = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];

      // Check required
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} is required`);
        continue;
      }

      // Skip validation if not required and not provided
      if (!rules.required && (value === undefined || value === null)) {
        continue;
      }

      // Run validator
      if (rules.validate && !rules.validate(value)) {
        errors.push(rules.message || `${field} is invalid`);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors,
      });
    }

    next();
  };
}

module.exports = {
  validate,
  isValidSolanaAddress,
  isValidBase64,
  isValidUUID,
};
