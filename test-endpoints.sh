#!/bin/bash

API="https://gasdf-api.onrender.com"
# Or when domain is setup: API="https://asdfasdfa.tech"

echo "🧪 GASdf API Test Suite"
echo "========================"
echo ""

# 1. Health check
echo "1️⃣  GET /health"
curl -s "$API/health" | python -m json.tool 2>&1 | head -20
echo ""

# 2. Get accepted tokens
echo "2️⃣  GET /v1/tokens"
curl -s "$API/v1/tokens" | python -m json.tool 2>&1 | head -20
echo ""

# 3. Quote request (sample)
echo "3️⃣  POST /v1/quote"
curl -s -X POST "$API/v1/quote" \
  -H "Content-Type: application/json" \
  -d '{
    "paymentTokenMint": "EPjFWaLb3odcccccccccccccccccccccccccccccccc",
    "userPubkey": "2s91VW55dNZhp7SGE9cPzyBVpJKMVB5yJpCs6YqZBhHQ",
    "amount": 1000000
  }' | python -m json.tool 2>&1
echo ""

echo "✅ Tests complete. Check /health status for deployment readiness."
