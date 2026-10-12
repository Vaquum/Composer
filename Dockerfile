FROM python:3.12-slim
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
WORKDIR /app
COPY index.html matcher.js pane-designs.js panes.css forecast.js bars.py server.py ./
USER 65534:65534
CMD ["python", "server.py", "--port", "8488"]
