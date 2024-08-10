ARG PYTHON_VERSION=3.11.0
FROM python:${PYTHON_VERSION}-slim as requirements-stage

WORKDIR /tmp

RUN pip install poetry

COPY ./pyproject.toml ./poetry.lock* /tmp/

RUN poetry export -f requirements.txt --output requirements.txt --without-hashes


FROM python:${PYTHON_VERSION}-slim as base
LABEL org.opencontainers.image.source=https://github.com/salakhovilia/coworker

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y libpq5 ffmpeg

COPY --from=requirements-stage /tmp/requirements.txt /app/requirements.txt

RUN pip install -r requirements.txt

# Copy the source code into the container.
COPY . .

# Expose the port that the application listens on.
EXPOSE 8000

# Run the application.
CMD ["fastapi", "run", "/app/main.py", "--proxy-headers", "--port", "8000"]
