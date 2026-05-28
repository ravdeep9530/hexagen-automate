FROM node:18

# Python for sandbox test runner + Docker CLI for deploying generated apps as containers.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-venv \
        ca-certificates curl gnupg lsb-release \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
 && chmod a+r /etc/apt/keyrings/docker.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce-cli \
 && rm -rf /var/lib/apt/lists/* \
 && pip3 install --no-cache-dir --break-system-packages \
        pytest pytest-asyncio pytest-mock requests uvicorn fastapi

# Shared npm cache so sandbox runs don't re-download deps every attempt.
# Mounted as a docker volume in compose so the cache survives container rebuilds.
RUN mkdir -p /var/cache/agent-npm && chmod 777 /var/cache/agent-npm

WORKDIR /app
COPY package*.json ./
RUN npm install --include=dev
COPY . .
EXPOSE 5000
CMD ["npm", "start"]
