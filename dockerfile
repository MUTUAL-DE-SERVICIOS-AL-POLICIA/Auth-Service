FROM node:24.4.1-alpine3.21

WORKDIR /app

COPY package.json ./
COPY yarn.lock ./

RUN yarn install

COPY . .