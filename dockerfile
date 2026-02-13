FROM node:24.13.0-alpine3.22

WORKDIR /app

COPY package.json ./
COPY pnpm-lock.yaml ./

RUN corepack enable pnpm && pnpm i --frozen-lockfile

COPY . .