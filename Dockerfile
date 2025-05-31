# Use official Node.js 22 image
FROM node:22-slim AS base

# Install pnpm globally
RUN npm install -g pnpm@10.11.0

# Install curl
RUN apt-get update && apt-get install -y curl git && rm -rf /var/lib/apt/lists/*

# Install vlayer
RUN curl -SL https://install.vlayer.xyz | bash

# Set working directory
WORKDIR /app

# Copy package manager files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy the rest of the application code
COPY . .

# Expose the default NestJS port
EXPOSE 3000

# Start the app
CMD ["pnpm", "start"]
