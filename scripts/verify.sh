#!/bin/bash

# Script to verify the project by running tests
# This script runs the test suite and can optionally generate coverage reports

set -e  # Exit on first error

echo "🔍 Running tests..."
npm test

echo ""
echo "✅ All tests passed!"
