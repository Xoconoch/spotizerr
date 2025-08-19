# Stage 1: Frontend build
FROM node:22-slim AS frontend-builder
WORKDIR /app/spotizerr-ui
RUN npm install -g pnpm
COPY spotizerr-ui/package.json spotizerr-ui/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY spotizerr-ui/. .
RUN pnpm build

# Stage 2: Final application image
FROM python:3.12-slim

# Set an environment variable for non-interactive frontend installation
ENV DEBIAN_FRONTEND=noninteractive

LABEL org.opencontainers.image.source="https://github.com/Xoconoch/spotizerr"

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gosu \
    git \
    ffmpeg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code (excluding UI source and TS source)
COPY . .

# Copy compiled assets from previous stages
COPY --from=frontend-builder /app/spotizerr-ui/dist ./spotizerr-ui/dist

# Create necessary directories with proper permissions
RUN mkdir -p downloads data/config data/creds data/watch data/history logs/tasks && \
    chmod -R 777 downloads data logs

# Make entrypoint script executable and fix line endings for Windows
RUN sed -i 's/\r$//' entrypoint.sh && chmod +x entrypoint.sh

# Set entrypoint to our script
ENTRYPOINT ["/app/entrypoint.sh"]
