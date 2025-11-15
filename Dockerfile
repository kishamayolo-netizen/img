# Lightweight, Fly.io-optimized, Puppeteer-ready
FROM zenika/alpine-chrome:120-with-node-20

# Set working directory
WORKDIR /app

# Copy and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app
COPY . .

# Set Puppeteer to use pre-installed Chrome
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Expose port
EXPOSE 3000

# Start server
CMD ["npm", "start"]
