# Visual Regression Action Docker Image
# Pre-built with all dependencies for fast CI execution
# This image is automatically built and published to GHCR

FROM mcr.microsoft.com/playwright@sha256:02810c978d5396bf382ab6015c25ad6bed9e39f4a41c5b9c829e9fea439274e2

# Install additional system dependencies
RUN apt-get update && apt-get install -y \
    imagemagick \
    git \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Install odiff globally via npm
RUN npm install -g odiff-bin@4.1.1

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
CMD ["node", "/action/dist/index.js"]
