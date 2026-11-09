#!/usr/bin/env bash
set -e

git config --local core.hooksPath .githooks
chmod +x .githooks/pre-push

echo "Git hooks enabled."