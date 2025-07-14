FROM docker.io/python:3.13.3-bookworm

# Add user app
RUN useradd -u 1001 app

# Create the app directory and set permissions to app
RUN mkdir /home/app/ && chown -R app:app /home/app

WORKDIR /home/app

# run the application as user app
USER app

# copy the dependencies file to the working directory
COPY --chown=app:app app/src/nexus/server/requirements.txt .

# install dependencies
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/home/app/.cargo/bin:${PATH}"
ENV PATH="/home/app/.local/bin:${PATH}"
RUN pip3 install --user -r requirements.txt --break-system-packages

# copy the content of the local src directory to the working directory
COPY --chown=app:app app/src/nexus/core nexus/core
COPY --chown=app:app app/src/nexus/server nexus/server

ENV PYTHONPATH="${PYTHONPATH}:/home/app/"

WORKDIR /home/app/nexus/server

RUN ls -l templates

# command to run on container start
CMD [ "python3", "-m", "fastapi", "run" , "--port", "8095", "--proxy-headers", "./server.py"]