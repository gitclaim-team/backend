# Use official Node.js 22 image
FROM ubuntu:24.04 AS base

# Install dependencies
RUN apt-get update && \
    apt-get install -y curl git ca-certificates libssl3 build-essential wget && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g pnpm@10.11.0 && \
    rm -rf /var/lib/apt/lists/*

# Install Foundry (forge)
RUN curl -L https://foundry.paradigm.xyz | bash && /root/.foundry/bin/foundryup
ENV PATH="/root/.foundry/bin:${PATH}"

# Install vlayer

# We need to install an specific version of vlayer
# and the vlayerup doesn't support that.
# RUN curl -SL https://install.vlayer.xyz | bash
# RUN . /root/.bashrc && vlayerup

RUN wget -O /tmp/binaries-linux-amd64.tar.gz https://github.com/vlayer-xyz/vlayer/releases/download/v1.0.2/binaries-linux-amd64.tar.gz && \
    mkdir -p /root/.vlayer && \
    tar -xzf /tmp/binaries-linux-amd64.tar.gz -C /root/.vlayer && \
    rm -rf /tmp/binaries-linux-amd64.tar.gz && \
    chmod +x /root/.vlayer/vlayer

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
