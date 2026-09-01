FROM node:22-alpine AS frontend-build

WORKDIR /app/frontend

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ARG http_proxy
ARG https_proxy
ARG no_proxy

COPY frontend/package*.json ./
RUN set -eux; \
    if [ -n "${HTTP_PROXY:-}" ]; then npm config set proxy "$HTTP_PROXY"; fi; \
    if [ -n "${http_proxy:-}" ]; then npm config set proxy "$http_proxy"; fi; \
    if [ -n "${HTTPS_PROXY:-}" ]; then npm config set https-proxy "$HTTPS_PROXY"; fi; \
    if [ -n "${https_proxy:-}" ]; then npm config set https-proxy "$https_proxy"; fi; \
    if [ -n "${NO_PROXY:-}" ]; then npm config set noproxy "$NO_PROXY"; fi; \
    if [ -n "${no_proxy:-}" ]; then npm config set noproxy "$no_proxy"; fi; \
    npm ci

COPY frontend/index.html ./
COPY frontend/public ./public
COPY frontend/src ./src

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
ARG VITE_TIME_ZONE=Europe/Moscow
ENV VITE_TIME_ZONE=$VITE_TIME_ZONE

RUN npm run build

FROM python:3.12-slim

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ARG http_proxy
ARG https_proxy
ARG no_proxy

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN set -eux; \
    apt_http_proxy="${HTTP_PROXY:-${http_proxy:-}}"; \
    apt_https_proxy="${HTTPS_PROXY:-${https_proxy:-}}"; \
    if [ -n "$apt_http_proxy" ]; then echo "Acquire::http::Proxy \"$apt_http_proxy\";" > /etc/apt/apt.conf.d/01proxy; fi; \
    if [ -n "$apt_https_proxy" ]; then echo "Acquire::https::Proxy \"$apt_https_proxy\";" >> /etc/apt/apt.conf.d/01proxy; fi; \
    apt-get update; \
    apt-get install -y --no-install-recommends nginx curl; \
    rm -f /etc/apt/apt.conf.d/01proxy /etc/nginx/sites-enabled/default /etc/nginx/sites-available/default; \
    rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./backend/requirements.txt
RUN set -eux; \
    export HTTP_PROXY="${HTTP_PROXY:-${http_proxy:-}}"; \
    export HTTPS_PROXY="${HTTPS_PROXY:-${https_proxy:-}}"; \
    export NO_PROXY="${NO_PROXY:-${no_proxy:-}}"; \
    export http_proxy="$HTTP_PROXY"; \
    export https_proxy="$HTTPS_PROXY"; \
    export no_proxy="$NO_PROXY"; \
    pip install --no-cache-dir -r ./backend/requirements.txt

COPY backend ./backend
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html
COPY deploy/nginx-single.conf /etc/nginx/conf.d/default.conf
COPY deploy/start-single.py /usr/local/bin/start-single.py
COPY deploy/healthcheck-single.py /usr/local/bin/healthcheck-single.py

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s \
  CMD python /usr/local/bin/healthcheck-single.py

CMD ["python", "/usr/local/bin/start-single.py"]
