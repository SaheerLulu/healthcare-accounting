# Build stage
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy built assets from build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx configuration (use dev config by default, can be overridden)
ARG NGINX_CONF=nginx.conf.dev
COPY ${NGINX_CONF} /etc/nginx/conf.d/default.conf

# Expose port 3000 (HTTP)
EXPOSE 3000

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
