FROM node:22-bullseye-slim

# Set the working directory in the container
WORKDIR /app

# Set the environment variable to skip Puppeteer download
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Install pnpm and dependencies
RUN npm install -g pnpm@9.15.4

COPY package.json pnpm-lock.yaml /app/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy the current directory contents into the container at /app
COPY ./ /app/

# Expose port 5173 to access the server
EXPOSE 5173

# Command to run the application
CMD ["pnpm", "exec", "vite", "--host", "0.0.0.0"]
