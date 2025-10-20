# Use lightweight Nginx image
FROM nginx:latest

# Remove default Nginx page
RUN rm -rf /usr/share/nginx/html/*

# Copy your custom frontend
COPY . /usr/share/nginx/html/

# Expose HTTP port
EXPOSE 80
