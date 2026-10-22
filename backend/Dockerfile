# Optional: for hosts that run containers (Fly.io, Railway, Google Cloud Run, Hugging Face Docker Spaces).
FROM python:3.12-slim
WORKDIR /app
COPY . /app
ENV PORT=8080
EXPOSE 8080
CMD ["python", "server.py"]
