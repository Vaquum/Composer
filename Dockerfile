FROM python:3.12-slim
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
WORKDIR /app
COPY matcher.js bars.py server.py engine.py engine.json ./
COPY bench ./bench
# The shared Filang engine, served to the page at /engine/: one published release, checked against the digest
# engine.json names. The server does not start without it.
RUN python engine.py --out /app/engine
RUN mkdir -p /var/cache/composer && chown 65534:65534 /var/cache/composer
ENV COMPOSER_CACHE_DIR=/var/cache/composer
USER 65534:65534
CMD ["python", "server.py", "--port", "8488"]
