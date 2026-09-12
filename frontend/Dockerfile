FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig*.json vite.config.ts postcss.config.js tailwind.config.js index.html ./
RUN npm ci

COPY src ./src
COPY public ./public

ARG VITE_API_BASE_URL=http://localhost:4000/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

FROM nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
