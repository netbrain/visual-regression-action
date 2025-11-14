# Visual Regression Action Docker Image
# Pre-built with all dependencies for fast CI execution

FROM mcr.microsoft.com/playwright:v1.48.0-jammy

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
