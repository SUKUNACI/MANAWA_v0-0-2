#!/bin/bash
set -e
cd backend
npm ci
npx prisma generate
npx prisma migrate deploy
