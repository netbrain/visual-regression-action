# Visual Regression Action Docker Image
# Pre-built with all dependencies for fast CI execution
# This image is automatically built and published to GHCR
# Playwright v1.56.1-jammy

FROM mcr.microsoft.com/playwright@sha256:d518367161e599b64e4e8b83ff180be45bfe22efb78dde77fc4c2942340fe8ca

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
