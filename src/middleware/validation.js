const domain = require('../domain/validation/validation');

// Re-export pure functions from domain (thin adapter)
const isValidSolanaAddress = domain.isValidSolanaAddress;
const isValidBase64 = domain.isValidBase64;
const isValidUUID = domain.isValidUUID;

// Validation schemas (HTTP-specific, stays in middleware)
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