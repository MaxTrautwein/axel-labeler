# Build context: repository root (the TS types are generated from docs/schema).
FROM node:24-alpine AS build
WORKDIR /repo/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY docs/schema /repo/docs/schema
COPY frontend/ ./
RUN npm run build

FROM nginx:1.29-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/frontend/dist/axel-labler/browser /usr/share/nginx/html
