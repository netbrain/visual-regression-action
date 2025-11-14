# Visual Regression Action Docker Image
# Pre-built with all dependencies for fast CI execution
# This image is automatically built and published to GHCR

# Playwright v1.55.1-noble
FROM mcr.microsoft.com/playwright@sha256:2f29369043d81d6d69a815ceb80760f55e85f5020371ad06a4d996f18503ad1c

# Install additional system dependencies
RUN apt-get update && apt-get install -y \
    imagemagick \
    git \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Install odiff globally via npm
RUN npm install -g odiff-bin@2.9.0

# Set working directory
WORKDIR /action

# Copy action files
COPY package*.json ./
RUN npm ci --production

# Copy action scripts
COPY dist/ ./dist/
COPY action.yml ./

# Set git safe directory (for GitHub Actions)
RUN git config --global --add safe.directory '*'

# Default command
CMD ["node", "dist/index.js"]
