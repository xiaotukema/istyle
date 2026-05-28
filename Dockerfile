FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm config set registry https://registry.npmmirror.com && npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=80

EXPOSE 80

CMD ["npm", "start"]
