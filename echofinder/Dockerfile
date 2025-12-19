FROM node:20-slim
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci --production
RUN npm cache clean --force
ENV NODE_ENV="production"
COPY . .
RUN chown -R node:node /usr/src/app
USER node
EXPOSE 3000
CMD [ "npm", "start" ]
