# ---- 建置階段 ----
FROM node:20-alpine AS build
WORKDIR /app

# 先只複製套件描述檔以善用 Docker 快取層
COPY package*.json ./
RUN npm install

COPY . .
# 前端 API 位址：空字串＝同源 /api（由 Caddy 代理到後端）
ARG VITE_API_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

# ---- 執行階段（以 Nginx 提供靜態檔案） ----
FROM nginx:1.27-alpine AS serve

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
