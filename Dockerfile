FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server ./server
COPY site ./site

# The chat counter (SQLite) lives here; mount a volume to keep it across restarts.
ENV DATA_DIR=/data
RUN useradd --system --no-create-home app && mkdir /data && chown app /data
USER app
VOLUME /data

EXPOSE 8000
CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8000"]
