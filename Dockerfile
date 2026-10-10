FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ngspice poppler-utils python3 python3-pip ca-certificates \
  && python3 -m pip install --no-cache-dir --break-system-packages volare sympy \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY server.mjs ./
COPY engine ./engine
COPY public ./public
COPY test ./test
COPY analog_design_agentic_ai_papers.md ./
COPY docker/entrypoint.sh /usr/local/bin/fusion-entrypoint

RUN chmod +x /usr/local/bin/fusion-entrypoint

ENV PORT=4174 \
    FUSION_SIMULATOR=ngspice \
    PYTHON_PATH=python3 \
    PDK_ROOT=/opt/pdks \
    PDK=sky130A \
    PDK_MODEL_FILE=/opt/pdks/sky130A/libs.tech/ngspice/sky130.lib.spice \
    SKY130_PDK_VERSION=7519dfb04400f224f140749cda44ee7de6f5e095

EXPOSE 4174
ENTRYPOINT ["fusion-entrypoint"]
CMD ["node", "server.mjs"]
