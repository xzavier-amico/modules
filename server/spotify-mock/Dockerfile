FROM node:20-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY .dev.vars.example ./

ENV HOST=0.0.0.0
ENV PORT=8787
EXPOSE 8787

# No runtime dependencies: the service only needs Node's built-in http/https
# and the Web-standard fetch/Request/Response APIs (Node 18+).
CMD ["node", "src/node.js"]
