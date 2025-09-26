FROM public.ecr.aws/amazonlinux/amazonlinux:2

# Install Node.js and npm
RUN yum update -y && \
    yum install -y nodejs npm && \
    yum clean all

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY index.ts ./
COPY tsconfig.json ./

# Install TypeScript globally and compile
RUN npm install -g typescript && \
    tsc index.ts --target es2020 --module commonjs --outDir dist

# Expose port
EXPOSE 3000

# Create non-root user for security
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app
USER appuser

# Start the application
CMD ["node", "dist/index.js"]