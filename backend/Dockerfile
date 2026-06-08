FROM python:3.12.3-slim-bullseye

ENV POETRY_VERSION=1.8.0 \
    PYTHONUNBUFFERED=1
ARG INSTALL_DEV_DEPS=false

# Install system dependencies
RUN if [ "$INSTALL_DEV_DEPS" = "true" ]; then \
      apt-get update && \
      apt-get install -y --no-install-recommends libatomic1 && \
      rm -rf /var/lib/apt/lists/*; \
    fi
RUN pip install "poetry==$POETRY_VERSION"

# Set work directory
WORKDIR /app

# Copy only requirements to cache them in docker layer
COPY poetry.lock pyproject.toml /app/

# Disable the creation of virtual environments
RUN poetry config virtualenvs.create false

# Install dependencies. The default image stays runtime-only; compose can opt
# into dev dependencies for test/type-check one-off jobs.
RUN if [ "$INSTALL_DEV_DEPS" = "true" ]; then \
      poetry install --with dev --no-interaction --no-ansi; \
    else \
      poetry install --only main --no-interaction --no-ansi; \
    fi

# Copy the current directory contents into the container at /app
COPY ./ /app/

EXPOSE 7001 1455 1457
